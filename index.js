const WebSocket = require('ws');
const fs = require('fs');

const FIREBASE_RTDB_URL = "https://commun-game-default-rtdb.europe-west1.firebasedatabase.app";
const FIRESTORE_URL = "https://firestore.googleapis.com/v1/projects/commun-game/databases/(default)/documents";
const SERVER_NAME = "official-server";

function logServer(level, message) {
    console.log(`[${new Date().toISOString()}] [${level}] ${message}`);
}

const SeededPRNG = function(seed) { 
    this.seed = seed || 1; 
    this.next = function() { 
        this.seed = (this.seed * 9301 + 49297) % 233280; 
        return this.seed / 233280; 
    }; 
};

const SimplexNoise = function(seed) {
    let prng = new SeededPRNG(seed);
    this.grad3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
    this.p = []; 
    for (let i=0; i<256; i++) { 
        this.p[i] = Math.floor(prng.next()*256); 
    }
    this.perm = new Array(512); 
    for(let i=0; i<512; i++) { 
        this.perm[i] = this.p[i & 255]; 
    }
};

SimplexNoise.prototype.dot = function(g, x, y) { 
    return g[0]*x + g[1]*y; 
};

SimplexNoise.prototype.noise = function(xin, yin) {
    let n0, n1, n2; 
    const F2 = 0.5*(Math.sqrt(3.0)-1.0), G2 = (3.0-Math.sqrt(3.0))/6.0;
    let s = (xin+yin)*F2; 
    let i = Math.floor(xin+s), j = Math.floor(yin+s);
    let t = (i+j)*G2; 
    let X0 = i-t, Y0 = j-t; 
    let x0 = xin-X0, y0 = yin-Y0;
    let i1, j1; 
    if(x0>y0) {i1=1; j1=0;} else {i1=0; j1=1;}
    let x1 = x0 - i1 + G2, y1 = y0 - j1 + G2; 
    let x2 = x0 - 1.0 + 2.0 * G2, y2 = y0 - 1.0 + 2.0 * G2;
    let ii = i & 255, jj = j & 255;
    let gi0 = this.perm[ii+this.perm[jj]] % 12; 
    let gi1 = this.perm[ii+i1+this.perm[jj+j1]] % 12; 
    let gi2 = this.perm[ii+1+this.perm[jj+1]] % 12;
    let t0 = 0.5 - x0*x0-y0*y0; 
    if(t0<0) n0 = 0.0; else { t0 *= t0; n0 = t0 * t0 * this.dot(this.grad3[gi0], x0, y0); }
    let t1 = 0.5 - x1*x1-y1*y1; 
    if(t1<0) n1 = 0.0; else { t1 *= t1; n1 = t1 * t1 * this.dot(this.grad3[gi1], x1, y1); }
    let t2 = 0.5 - x2*x2-y2*y2; 
    if(t2<0) n2 = 0.0; else { t2 *= t2; n2 = t2 * t2 * this.dot(this.grad3[gi2], x2, y2); }
    return 70.0 * (n0 + n1 + n2);
};

const PORT = process.env.PORT || 8080;
const TILE_SIZE = 40;
const CHUNK_SIZE = 16;
const SEED = 12345; 
const noiseGen = new SimplexNoise(SEED);
const secondaryNoise = new SimplexNoise(SEED + 100);

const TILES = {
    0: { solid: false, speedMult: 0.4 }, 
    1: { solid: false, speedMult: 1.0 }, 
    2: { solid: false, speedMult: 1.0 },
    3: { solid: false, speedMult: 1.0, gatherTime: 2000, replaces: 2, drops: [{id: "wood", min: 2, max: 2}, {id: "apple", min: 0, max: 1}], isStructure: false },
    4: { solid: true, speedMult: 1.0, gatherTime: 2500, replaces: 2, drops: [{id: "stone", min: 2, max: 2}, {id: "ore", min: 0, max: 1}], isStructure: false },
    7: { solid: false, speedMult: 1.0, gatherTime: 1000, replaces: 2, drops: [{id: "fiber", min: 1, max: 1}], isStructure: false },
    8: { solid: false, speedMult: 1.0, gatherTime: 1200, replaces: 2, drops: [{id: "berry", min: 2, max: 2}, {id: "fiber", min: 1, max: 1}], isStructure: false },
    5: { solid: true, speedMult: 1.0, replaces: 2, drops: [{id: "wood", min: 1, max: 1}], isStructure: true, maxHp: 100 },
    6: { solid: true, speedMult: 1.0, replaces: 2, drops: [{id: "stone", min: 1, max: 1}], isStructure: true, maxHp: 300 },
    9: { solid: true, speedMult: 1.0, replaces: 2, drops: [{id: "wood", min: 2, max: 2}], isStructure: true, maxHp: 150 },
    10: { solid: true, speedMult: 1.0, replaces: 2, drops: [{id: "stone", min: 1, max: 1}], isStructure: true, maxHp: 100 },
    11: { solid: true, speedMult: 1.0, replaces: 2, drops: [{id: "stone", min: 3, max: 3}], isStructure: true, maxHp: 250 },
    12: { solid: false, speedMult: 1.0, replaces: 2, drops: [], isStructure: true, maxHp: 50 },
    13: { solid: false, speedMult: 1.0, replaces: 2, drops: [{id: "seed", min: 1, max: 1}], isStructure: true, maxHp: 50 },
    14: { solid: false, speedMult: 1.0, replaces: 12, drops: [{id: "wheat", min: 2, max: 2}], isStructure: true, maxHp: 50 },
    15: { solid: true, speedMult: 1.0, replaces: 2, drops: [{id: "wood", min: 2, max: 2}], isStructure: true, maxHp: 150 },
    16: { solid: false, speedMult: 1.0, replaces: 2, drops: [{id: "wood", min: 1, max: 1}], isStructure: true, maxHp: 100 },
    17: { solid: false, speedMult: 1.0, replaces: 2, drops: [{id: "stone", min: 1, max: 1}], isStructure: true, maxHp: 300 }
};

const ENTITY_TYPES = {
    'deer': { maxHp: 30, speed: 0.08, type: 'passive', drops: [{id: 'meat', min: 1, max: 2}] },
    'wolf': { maxHp: 60, speed: 0.11, type: 'aggressive', dmg: 10, aggroRange: 200, attackRange: 40, attackCooldown: 1500, drops: [{id: 'meat', min: 1, max: 2}] },
    'bear': { maxHp: 120, speed: 0.09, type: 'aggressive', dmg: 20, aggroRange: 150, attackRange: 50, attackCooldown: 2000, drops: [{id: 'meat', min: 2, max: 4}] }
};

let chunks = {}; 
let players = {}; 
let entities = {}; 
let teams = {}; 
let time = 8000;

const SAVE_FILE = './save.json';

function loadGame() {
    if (fs.existsSync(SAVE_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
            chunks = data.chunks || {};
            entities = data.entities || {};
            teams = data.teams || {};
            time = data.time || 8000;
            
            if (data.players) {
                Object.values(data.players).forEach(p => {
                    players[p.id] = { ...p, ws: null, activeChunks: new Set() };
                });
            }
            logServer('INFO', 'Game state loaded successfully from save file.');
        } catch (e) {
            logServer('ERROR', `Failed to read save file: ${e.message}`);
        }
    } else {
        logServer('INFO', 'No save file found. Initializing new game state.');
    }
}

function saveGame() {
    let savedPlayers = {};
    Object.values(players).forEach(p => {
        savedPlayers[p.id] = {
            id: p.id, username: p.username, team: p.team,
            x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, hunger: p.hunger, stamina: p.stamina,
            invites: p.invites
        };
    });
    const dataToSave = { chunks, entities, teams, time, players: savedPlayers };
    try {
        fs.writeFileSync(SAVE_FILE, JSON.stringify(dataToSave));
        logServer('INFO', 'Game state saved to disk.');
    } catch (e) {
        logServer('ERROR', `Failed to save game state: ${e.message}`);
    }
}

loadGame();
setInterval(saveGame, 30000);

const Utils = { 
    distance: (x1, y1, x2, y2) => Math.sqrt((x2-x1)**2 + (y2-y1)**2) 
};

function getBaseTile(tx, ty) {
    let n = noiseGen.noise(tx * 0.05, ty * 0.05); 
    if (n < -0.3) return 0; 
    if (n < -0.1) return 1;
    let v = noiseGen.noise(tx * 0.1 + 100, ty * 0.1 + 100); 
    if (n > 0.3 && v > 0.2) return 4; 
    if (n > 0.0 && v < -0.1) return 3;
    if (n > -0.05 && n < 0.2) { 
        let bushNoise = secondaryNoise.noise(tx * 0.5, ty * 0.5); 
        if (bushNoise > 0.6) return 8; 
        if (bushNoise > 0.4) return 7; 
    }
    return 2;
}

function getChunkKey(tx, ty) { 
    return `${Math.floor(tx/CHUNK_SIZE)},${Math.floor(ty/CHUNK_SIZE)}`; 
}

function getTile(tx, ty) {
    let cKey = getChunkKey(tx, ty); 
    let key = `${tx},${ty}`;
    if (chunks[cKey] && chunks[cKey].modifiedTiles[key] !== undefined) {
        return chunks[cKey].modifiedTiles[key];
    }
    return getBaseTile(tx, ty);
}

function setTile(tx, ty, tileId) {
    let cKey = getChunkKey(tx, ty);
    if (!chunks[cKey]) chunks[cKey] = { modifiedTiles: {}, structures: {}, droppedItems: [] };
    chunks[cKey].modifiedTiles[`${tx},${ty}`] = tileId;
    broadcastChunkUpdate(cKey);
}

function spawnDroppedItem(baseId, amount, x, y) {
    let tx = Math.floor(x/TILE_SIZE); 
    let ty = Math.floor(y/TILE_SIZE); 
    let cKey = getChunkKey(tx, ty);
    if (!chunks[cKey]) chunks[cKey] = { modifiedTiles: {}, structures: {}, droppedItems: [] };
    chunks[cKey].droppedItems.push({ id: Date.now() + Math.random(), baseId, amount, x, y, expire: Date.now() + 60000 });
    broadcastChunkUpdate(cKey);
}

function broadcastMsg(sender, msg, channel) {
    logServer('CHAT', `[${channel}] ${sender}: ${msg}`);
    Object.values(players).forEach(p => {
        if (p.ws) {
            p.ws.send(JSON.stringify({ type: 'CHAT', sender: sender, msg: msg, channel: channel }));
        }
    });
}

function broadcastChunkUpdate(cKey) {
    Object.values(players).forEach(p => {
        if (p.ws && p.activeChunks.has(cKey)) {
            p.ws.send(JSON.stringify({ type: 'CHUNK_DATA', cKey: cKey, data: chunks[cKey] }));
        }
    });
}

const wss = new WebSocket.Server({ port: PORT });
logServer('INFO', `WebSocket Server initialized and listening on port ${PORT}.`);

wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    logServer('INFO', `New connection established from IP: ${ip}`);

    const authCode = Math.random().toString(36).substring(2, 10);
    ws.send(JSON.stringify({ type: 'AUTH_REQ', code: authCode, serverName: SERVER_NAME }));

    let authenticated = false;
    let pid = null;

    ws.on('message', async (message) => {
        let data; 
        try { 
            data = JSON.parse(message); 
        } catch(e) { 
            logServer('WARN', `Received malformed JSON message from IP: ${ip}`);
            return; 
        }

        if (!authenticated) {
            if (data.type === 'AUTH_SUBMIT' && data.uid) {
                logServer('INFO', `Authentication request received for UID: ${data.uid}`);
                try {
                    const uid = data.uid;
                    const rtdbRes = await fetch(`${FIREBASE_RTDB_URL}/user-server-keys/${uid}/${SERVER_NAME}.json`);
                    const rtdbData = await rtdbRes.json();
                    
                    let isValid = false;
                    if (rtdbData === authCode) isValid = true;

                    if (!isValid) {
                        logServer('WARN', `Authentication failed for UID: ${uid} - Invalid auth code.`);
                        ws.send(JSON.stringify({ type: 'AUTH_FAIL', msg: 'SYS_auth_invalid' }));
                        return;
                    }

                    const fsRes = await fetch(`${FIRESTORE_URL}/Users/${uid}`);
                    const fsData = await fsRes.json();
                    
                    let username = "Player_" + uid.substring(0, 5);
                    if (fsData && fsData.fields && fsData.fields.username && fsData.fields.username.stringValue) {
                        username = fsData.fields.username.stringValue;
                    }

                    authenticated = true;
                    pid = uid;

                    if (!players[pid]) {
                        let sx = 0, sy = 0; 
                        while(getBaseTile(sx, sy) === 0 || TILES[getBaseTile(sx, sy)].solid) { sx++; sy++; }
                        players[pid] = {
                            id: pid, ws: ws, username: username, team: null,
                            x: sx * TILE_SIZE + TILE_SIZE/2, y: sy * TILE_SIZE + TILE_SIZE/2,
                            hp: 100, maxHp: 100, hunger: 100, stamina: 100,
                            activeChunks: new Set(), invites: []
                        };
                        logServer('INFO', `New player profile created for UID: ${uid} (${username})`);
                    } else {
                        players[pid].ws = ws;
                        players[pid].username = username;
                        players[pid].activeChunks = new Set();
                        logServer('INFO', `Existing player profile loaded for UID: ${uid} (${username})`);
                    }

                    ws.send(JSON.stringify({ type: 'INIT', id: pid, seed: SEED, x: players[pid].x, y: players[pid].y, time: time }));
                    broadcastMsg("Sistem", "SYS_sys_joined", 'global', [players[pid].username]);

                } catch (err) {
                    logServer('ERROR', `Authentication process encountered an error for UID: ${data.uid}. Details: ${err.message}`);
                    ws.send(JSON.stringify({ type: 'AUTH_FAIL', msg: 'SYS_auth_err' }));
                }
            }
            return;
        }

        let p = players[pid]; 
        if(!p || !p.ws) return;

        if (data.type === 'MOVE') {
            p.x = data.x; 
            p.y = data.y; 
            p.hp = data.hp; 
            p.hunger = data.hunger; 
            p.stamina = data.stamina;
        } 
        else if (data.type === 'REQ_CHUNKS') {
            data.chunks.forEach(cKey => {
                p.activeChunks.add(cKey);
                if (!chunks[cKey]) {
                    chunks[cKey] = { modifiedTiles: {}, structures: {}, droppedItems: [] };
                    logServer('INFO', `Generated new chunk object for key: ${cKey}`);
                }
                ws.send(JSON.stringify({ type: 'CHUNK_DATA', cKey: cKey, data: chunks[cKey] }));
            });
        }
        else if (data.type === 'DROP_ITEM') {
            logServer('ACTION', `Player ${p.username} dropped item baseId: ${data.baseId}, amount: ${data.amount}`);
            spawnDroppedItem(data.baseId, data.amount, p.x + (Math.random()*30-15), p.y + (Math.random()*30-15));
        }
        else if (data.type === 'PICKUP') {
            let cKey = getChunkKey(Math.floor(data.x/TILE_SIZE), Math.floor(data.y/TILE_SIZE));
            if (chunks[cKey] && chunks[cKey].droppedItems) {
                let idx = chunks[cKey].droppedItems.findIndex(i => i.id === data.itemId);
                if (idx !== -1) {
                    let item = chunks[cKey].droppedItems[idx];
                    if (Utils.distance(p.x, p.y, item.x, item.y) < TILE_SIZE * 2) {
                        chunks[cKey].droppedItems.splice(idx, 1);
                        ws.send(JSON.stringify({ type: 'GIVE_ITEM', baseId: item.baseId, amount: item.amount }));
                        broadcastChunkUpdate(cKey);
                        logServer('ACTION', `Player ${p.username} picked up item baseId: ${item.baseId}`);
                    }
                }
            }
        }
        else if (data.type === 'GATHER') {
            let tid = getTile(data.tx, data.ty); 
            let tData = TILES[tid];
            if (tData && !tData.isStructure && Utils.distance(p.x/TILE_SIZE, p.y/TILE_SIZE, data.tx, data.ty) <= 4) {
                tData.drops.forEach(d => { 
                    let amount = Math.floor(Math.random() * (d.max - d.min + 1)) + d.min;
                    if(amount > 0) {
                        ws.send(JSON.stringify({ type: 'GIVE_ITEM', baseId: d.id, amount: amount })); 
                    }
                });
                setTile(data.tx, data.ty, tData.replaces);
                logServer('ACTION', `Player ${p.username} gathered resources at ${data.tx},${data.ty}`);
            }
        }
        else if (data.type === 'BUILD') {
            let cKey = getChunkKey(data.tx, data.ty); 
            let tKey = `${data.tx},${data.ty}`;
            if (!chunks[cKey]) chunks[cKey] = { modifiedTiles: {}, structures: {}, droppedItems: [] };
            setTile(data.tx, data.ty, data.buildId);
            let bHp = TILES[data.buildId].maxHp * (1 + data.skillLevel * 0.1);
            chunks[cKey].structures[tKey] = { type: data.structureType || 'wall', hp: bHp, maxHp: bHp, ownerId: p.id, ownerTeam: p.team, inventory: {} };
            broadcastChunkUpdate(cKey);
            logServer('ACTION', `Player ${p.username} built structure ${data.buildId} at ${data.tx},${data.ty}`);
        }
        else if (data.type === 'DEMOLISH') {
            let cKey = getChunkKey(data.tx, data.ty); 
            let tKey = `${data.tx},${data.ty}`;
            let struct = chunks[cKey] ? chunks[cKey].structures[tKey] : null;
            if (struct) {
                if (struct.ownerId === p.id || (p.team && struct.ownerTeam === p.team)) {
                    Object.keys(struct.inventory).forEach(uid => { 
                        spawnDroppedItem(struct.inventory[uid].baseId, struct.inventory[uid].amount, data.tx*TILE_SIZE, data.ty*TILE_SIZE); 
                    });
                    let tData = TILES[getTile(data.tx, data.ty)];
                    if (tData && tData.drops) { 
                        tData.drops.forEach(d => { 
                            if(Math.random() <= 0.8) ws.send(JSON.stringify({type: 'GIVE_ITEM', baseId: d.id, amount: 1})); 
                        }); 
                    }
                    setTile(data.tx, data.ty, tData.replaces || 2);
                    delete chunks[cKey].structures[tKey]; 
                    broadcastChunkUpdate(cKey);
                    logServer('ACTION', `Player ${p.username} demolished structure at ${data.tx},${data.ty}`);
                }
            }
        }
        else if (data.type === 'ATTACK_ENTITY') {
            let ent = entities[data.entityId];
            if (ent && Utils.distance(p.x, p.y, ent.x, ent.y) <= 80) {
                ent.hp -= data.dmg; 
                ent.state = ENTITY_TYPES[ent.type].type === 'aggressive' ? 'chase' : 'flee'; 
                ent.timer = 5000;
                logServer('ACTION', `Player ${p.username} attacked entity ${ent.type} (${ent.id}) for ${data.dmg} damage.`);
                if (ent.hp <= 0) {
                    ENTITY_TYPES[ent.type].drops.forEach(d => {
                        let amount = Math.floor(Math.random() * (d.max - d.min + 1)) + d.min;
                        if(amount > 0) spawnDroppedItem(d.id, amount, ent.x, ent.y);
                    });
                    delete entities[data.entityId];
                    logServer('ACTION', `Entity ${ent.type} (${data.entityId}) was killed by ${p.username}.`);
                }
            }
        }
        else if (data.type === 'ATTACK_STRUCT') {
            let cKey = getChunkKey(data.tx, data.ty); 
            let tKey = `${data.tx},${data.ty}`;
            let struct = chunks[cKey] ? chunks[cKey].structures[tKey] : null;
            if (struct && Utils.distance(p.x/TILE_SIZE, p.y/TILE_SIZE, data.tx, data.ty) <= 4) {
                if (struct.ownerTeam && p.team === struct.ownerTeam) return; 
                struct.hp -= data.dmg;
                if (struct.hp <= 0) {
                    Object.keys(struct.inventory).forEach(uid => { 
                        spawnDroppedItem(struct.inventory[uid].baseId, struct.inventory[uid].amount, data.tx*TILE_SIZE, data.ty*TILE_SIZE); 
                    });
                    setTile(data.tx, data.ty, TILES[getTile(data.tx, data.ty)].replaces || 2);
                    delete chunks[cKey].structures[tKey];
                    logServer('ACTION', `Player ${p.username} destroyed a structure at ${data.tx},${data.ty}.`);
                }
                broadcastChunkUpdate(cKey);
            }
        }
        else if (data.type === 'SYNC_CHEST') {
            let cKey = getChunkKey(data.tx, data.ty); 
            let tKey = `${data.tx},${data.ty}`;
            if (chunks[cKey] && chunks[cKey].structures[tKey]) {
                let struct = chunks[cKey].structures[tKey];
                if (struct.ownerTeam && p.team !== struct.ownerTeam && struct.ownerId !== p.id) return; 
                struct.inventory = data.inventory; 
                broadcastChunkUpdate(cKey);
            }
        }
        else if (data.type === 'INTERACT_FARM') {
            let cKey = getChunkKey(data.tx, data.ty); 
            let tKey = `${data.tx},${data.ty}`;
            if (chunks[cKey] && chunks[cKey].structures[tKey] && chunks[cKey].structures[tKey].type === 'farm') {
                if (data.action === 'plant') {
                    setTile(data.tx, data.ty, 13); 
                    chunks[cKey].structures[tKey].progress = 0;
                    logServer('ACTION', `Player ${p.username} planted seeds at ${data.tx},${data.ty}.`);
                } else if (data.action === 'harvest' && getTile(data.tx, data.ty) === 14) {
                    setTile(data.tx, data.ty, 12); 
                    delete chunks[cKey].structures[tKey];
                    ws.send(JSON.stringify({ type: 'GIVE_ITEM', baseId: 'wheat', amount: 2 }));
                    if(Math.random() < 0.8) {
                        ws.send(JSON.stringify({ type: 'GIVE_ITEM', baseId: 'seed', amount: 1 }));
                    }
                    logServer('ACTION', `Player ${p.username} harvested crops at ${data.tx},${data.ty}.`);
                }
            }
        }
        else if (data.type === 'INTERACT_DOOR') {
            let tid = getTile(data.tx, data.ty);
            if (tid === 5) setTile(data.tx, data.ty, 16); 
            else if (tid === 6) setTile(data.tx, data.ty, 17);
            else if (tid === 16) setTile(data.tx, data.ty, 5); 
            else if (tid === 17) setTile(data.tx, data.ty, 6);
        }
        else if (data.type === 'CLAN_CREATE') {
            if (p.team) return;
            if (teams[data.name]) { 
                p.ws.send(JSON.stringify({type:'CHAT', sender:'Sistem', msg:'SYS_sys_clan_exist', channel: 'global'})); 
                return; 
            }
            teams[data.name] = { name: data.name, owner: p.id, members: [p.id] };
            p.team = data.name;
            logServer('CLAN', `Player ${p.username} created clan: ${data.name}`);
        }
        else if (data.type === 'CLAN_INVITE') {
            if (!p.team || teams[p.team].owner !== p.id) return;
            let target = Object.values(players).find(pl => pl.username === data.username && pl.ws);
            if (target && !target.team) {
                if (!target.invites.some(i => i.clanName === p.team)) {
                    target.invites.push({ clanName: p.team, senderName: p.username });
                    target.ws.send(JSON.stringify({type:'CHAT', sender:'Sistem', msg:'SYS_sys_clan_invite', channel: 'global', args: [p.team]}));
                    logServer('CLAN', `Player ${p.username} invited ${target.username} to clan ${p.team}`);
                }
            }
        }
        else if (data.type === 'CLAN_ACCEPT') {
            let invIndex = p.invites.findIndex(i => i.clanName === data.clanName);
            if (invIndex !== -1) {
                let cName = data.clanName; 
                p.invites.splice(invIndex, 1);
                if (teams[cName] && !p.team) {
                    p.team = cName; 
                    teams[cName].members.push(p.id);
                    broadcastMsg("Sistem", "SYS_sys_clan_join", 'global', [p.username, cName]);
                    logServer('CLAN', `Player ${p.username} joined clan: ${cName}`);
                }
            }
        }
        else if (data.type === 'CLAN_DECLINE') {
            p.invites = p.invites.filter(i => i.clanName !== data.clanName);
            logServer('CLAN', `Player ${p.username} declined invite to clan: ${data.clanName}`);
        }
        else if (data.type === 'CLAN_LEAVE') {
            if (!p.team) return;
            let t = teams[p.team];
            t.members = t.members.filter(id => id !== p.id);
            if (t.members.length === 0) { 
                delete teams[p.team]; 
                logServer('CLAN', `Clan ${p.team} was disbanded as the last member left.`);
            } 
            else if (t.owner === p.id) { 
                t.owner = t.members[0]; 
                logServer('CLAN', `Ownership of clan ${p.team} transferred to member ID: ${t.owner}`);
            }
            logServer('CLAN', `Player ${p.username} left clan: ${p.team}`);
            p.team = null;
        }
        else if (data.type === 'CLAN_KICK') {
            if (!p.team || teams[p.team].owner !== p.id) return;
            let t = teams[p.team];
            if (data.targetId !== p.id) {
                t.members = t.members.filter(id => id !== data.targetId);
                if (players[data.targetId]) {
                    players[data.targetId].team = null;
                    if (players[data.targetId].ws) {
                        players[data.targetId].ws.send(JSON.stringify({type:'CHAT', sender:'Sistem', msg:'SYS_sys_kicked', channel: 'global'}));
                    }
                    logServer('CLAN', `Player ${players[data.targetId].username} was kicked from clan ${p.team} by ${p.username}`);
                }
            }
        }
        else if (data.type === 'CHAT') {
            if (data.channel === 'team' && p.team) {
                logServer('CHAT', `[TEAM - ${p.team}] ${p.username}: ${data.msg}`);
                teams[p.team].members.forEach(mId => {
                    if (players[mId] && players[mId].ws) {
                        players[mId].ws.send(JSON.stringify({ type: 'CHAT', sender: p.username, msg: data.msg, channel: 'team' }));
                    }
                });
            } else {
                broadcastMsg(p.username, data.msg, 'global');
            }
        }
    });

    ws.on('close', () => {
        if (pid && players[pid]) {
            players[pid].ws = null;
            broadcastMsg("Sistem", "SYS_sys_left", 'global', [players[pid].username]);
            logServer('INFO', `Client disconnected: UID ${pid} (${players[pid].username})`);
        } else {
            logServer('INFO', `Client disconnected without active session.`);
        }
    });
});

let lastLoopTime = Date.now();

setInterval(() => {
    let now = Date.now();
    let dt = now - lastLoopTime;
    lastLoopTime = now;
    if (dt > 100) dt = 100;

    time += dt * 0.05;
    if (time > 24000) time = 0;

    Object.keys(chunks).forEach(cKey => {
        let c = chunks[cKey];
        let changed = false;
        for (let i = c.droppedItems.length - 1; i >= 0; i--) {
            c.droppedItems[i].expire -= dt;
            if (c.droppedItems[i].expire <= 0) {
                c.droppedItems.splice(i, 1);
                changed = true;
            }
        }
        if (changed) broadcastChunkUpdate(cKey);
    });

    let activePlayers = Object.values(players).filter(p => p.ws !== null);

    if (Object.keys(entities).length < 20 && activePlayers.length > 0) {
        let rp = activePlayers[Math.floor(Math.random() * activePlayers.length)];
        let angle = Math.random() * Math.PI * 2;
        let dist = 500 + Math.random() * 300;
        let sx = rp.x + Math.cos(angle) * dist;
        let sy = rp.y + Math.sin(angle) * dist;
        let stx = Math.floor(sx / TILE_SIZE);
        let sty = Math.floor(sy / TILE_SIZE);
        
        if (!TILES[getTile(stx, sty)].solid && getTile(stx, sty) !== 0) {
            let types = ['deer', 'deer', 'wolf', 'bear'];
            let t = types[Math.floor(Math.random() * types.length)];
            let eid = 'e_' + Date.now() + Math.floor(Math.random() * 1000);
            entities[eid] = { 
                id: eid, type: t, x: sx, y: sy, hp: ENTITY_TYPES[t].maxHp, 
                maxHp: ENTITY_TYPES[t].maxHp, vx: 0, vy: 0, state: 'idle', 
                timer: 0, attackCooldown: 0 
            };
        }
    }

    Object.values(entities).forEach(ent => {
        let def = ENTITY_TYPES[ent.type];
        ent.timer -= dt;
        ent.attackCooldown -= dt;

        let nearestP = null; 
        let minDist = Infinity;
        
        activePlayers.forEach(p => {
            let d = Utils.distance(ent.x, ent.y, p.x, p.y);
            if (d < minDist) { 
                minDist = d; 
                nearestP = p; 
            }
        });

        if (!nearestP || minDist > 1500) { 
            delete entities[ent.id]; 
            return; 
        }

        if (def.type === 'aggressive' && minDist < def.aggroRange && ent.state !== 'flee') {
            ent.state = 'chase';
        } else if (ent.state === 'flee' && ent.timer <= 0) {
            ent.state = 'idle';
        } else if (ent.state === 'chase' && minDist > def.aggroRange * 1.5) {
            ent.state = 'idle';
        }

        if (ent.state === 'idle' || ent.state === 'wander') {
            if (ent.timer <= 0) {
                if (Math.random() < 0.5) {
                    ent.state = 'wander';
                    let angle = Math.random() * Math.PI * 2;
                    ent.vx = Math.cos(angle) * def.speed * 0.5;
                    ent.vy = Math.sin(angle) * def.speed * 0.5;
                    ent.timer = 1000 + Math.random() * 2000;
                } else {
                    ent.state = 'idle';
                    ent.vx = 0; 
                    ent.vy = 0;
                    ent.timer = 1000 + Math.random() * 2000;
                }
            }
        } else if (ent.state === 'chase') {
            if (minDist < def.attackRange) {
                ent.vx = 0; 
                ent.vy = 0;
                if (ent.attackCooldown <= 0) {
                    nearestP.ws.send(JSON.stringify({ type: 'DAMAGE', amount: def.dmg }));
                    ent.attackCooldown = def.attackCooldown;
                }
            } else {
                let angle = Math.atan2(nearestP.y - ent.y, nearestP.x - ent.x);
                ent.vx = Math.cos(angle) * def.speed;
                ent.vy = Math.sin(angle) * def.speed;
            }
        } else if (ent.state === 'flee') {
            let angle = Math.atan2(ent.y - nearestP.y, ent.x - nearestP.x);
            ent.vx = Math.cos(angle) * def.speed * 1.2;
            ent.vy = Math.sin(angle) * def.speed * 1.2;
        }

        let currentTid = getTile(Math.floor(ent.x / TILE_SIZE), Math.floor(ent.y / TILE_SIZE));
        let speedMult = (TILES[currentTid] && TILES[currentTid].speedMult) ? TILES[currentTid].speedMult : 1.0;

        let nx = ent.x + (ent.vx * speedMult) * dt;
        let ny = ent.y + (ent.vy * speedMult) * dt;

        if (!TILES[getTile(Math.floor(nx / TILE_SIZE), Math.floor(ent.y / TILE_SIZE))].solid) {
            ent.x = nx; 
        } else {
            ent.vx *= -1;
        }
        
        if (!TILES[getTile(Math.floor(ent.x / TILE_SIZE), Math.floor(ny / TILE_SIZE))].solid) {
            ent.y = ny; 
        } else {
            ent.vy *= -1;
        }
    });

    let sPlayers = activePlayers.map(p => ({ 
        id: p.id, username: p.username, team: p.team, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp 
    }));
    let sEntities = Object.values(entities);

    activePlayers.forEach(p => {
        let teamData = null;
        if (p.team && teams[p.team]) {
            teamData = {
                name: teams[p.team].name,
                owner: teams[p.team].owner,
                members: teams[p.team].members.map(mId => ({ 
                    id: mId, 
                    username: players[mId] ? players[mId].username : "Unknown" 
                }))
            };
        }
        if (p.ws) {
            p.ws.send(JSON.stringify({
                type: 'SYNC_STATE',
                time: time,
                players: sPlayers,
                entities: sEntities,
                teamData: teamData,
                invites: p.invites
            }));
        }
    });
}, 100);