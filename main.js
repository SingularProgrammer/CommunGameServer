const WebSocket = require('ws');

const SeededPRNG = function(seed) { this.seed = seed || 1; this.next = function() { this.seed = (this.seed * 9301 + 49297) % 233280; return this.seed / 233280; }; };
const SimplexNoise = function(seed) {
    let prng = new SeededPRNG(seed);
    this.grad3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
    this.p = []; for (let i=0; i<256; i++) { this.p[i] = Math.floor(prng.next()*256); }
    this.perm = new Array(512); for(let i=0; i<512; i++) { this.perm[i] = this.p[i & 255]; }
};
SimplexNoise.prototype.dot = function(g, x, y) { return g[0]*x + g[1]*y; };
SimplexNoise.prototype.noise = function(xin, yin) {
    let n0, n1, n2; const F2 = 0.5*(Math.sqrt(3.0)-1.0), G2 = (3.0-Math.sqrt(3.0))/6.0;
    let s = (xin+yin)*F2; let i = Math.floor(xin+s), j = Math.floor(yin+s);
    let t = (i+j)*G2; let X0 = i-t, Y0 = j-t; let x0 = xin-X0, y0 = yin-Y0;
    let i1, j1; if(x0>y0) {i1=1; j1=0;} else {i1=0; j1=1;}
    let x1 = x0 - i1 + G2, y1 = y0 - j1 + G2; let x2 = x0 - 1.0 + 2.0 * G2, y2 = y0 - 1.0 + 2.0 * G2;
    let ii = i & 255, jj = j & 255;
    let gi0 = this.perm[ii+this.perm[jj]] % 12; let gi1 = this.perm[ii+i1+this.perm[jj+j1]] % 12; let gi2 = this.perm[ii+1+this.perm[jj+1]] % 12;
    let t0 = 0.5 - x0*x0-y0*y0; if(t0<0) n0 = 0.0; else { t0 *= t0; n0 = t0 * t0 * this.dot(this.grad3[gi0], x0, y0); }
    let t1 = 0.5 - x1*x1-y1*y1; if(t1<0) n1 = 0.0; else { t1 *= t1; n1 = t1 * t1 * this.dot(this.grad3[gi1], x1, y1); }
    let t2 = 0.5 - x2*x2-y2*y2; if(t2<0) n2 = 0.0; else { t2 *= t2; n2 = t2 * t2 * this.dot(this.grad3[gi2], x2, y2); }
    return 70.0 * (n0 + n1 + n2);
};

const PORT = process.env.PORT || 8080;
const TILE_SIZE = 40;
const CHUNK_SIZE = 16;
const SEED = 12345; 
const noiseGen = new SimplexNoise(SEED);
const secondaryNoise = new SimplexNoise(SEED + 100);

const TILES = {
    0: { solid: false, speedMult: 0.4 }, 1: { solid: false, speedMult: 1.0 }, 2: { solid: false, speedMult: 1.0 },
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

const Utils = { distance: (x1,y1,x2,y2) => Math.sqrt((x2-x1)**2 + (y2-y1)**2) };

function getBaseTile(tx, ty) {
    let n = noiseGen.noise(tx * 0.05, ty * 0.05); if (n < -0.3) return 0; if (n < -0.1) return 1;
    let v = noiseGen.noise(tx * 0.1 + 100, ty * 0.1 + 100); if (n > 0.3 && v > 0.2) return 4; if (n > 0.0 && v < -0.1) return 3;
    if (n > -0.05 && n < 0.2) { let bushNoise = secondaryNoise.noise(tx * 0.5, ty * 0.5); if (bushNoise > 0.6) return 8; if (bushNoise > 0.4) return 7; }
    return 2;
}

function getChunkKey(tx, ty) { return `${Math.floor(tx/CHUNK_SIZE)},${Math.floor(ty/CHUNK_SIZE)}`; }

function getTile(tx, ty) {
    let cKey = getChunkKey(tx, ty); let key = `${tx},${ty}`;
    if (chunks[cKey] && chunks[cKey].modifiedTiles[key] !== undefined) return chunks[cKey].modifiedTiles[key];
    return getBaseTile(tx, ty);
}

function setTile(tx, ty, tileId) {
    let cKey = getChunkKey(tx, ty);
    if (!chunks[cKey]) chunks[cKey] = { modifiedTiles: {}, structures: {}, droppedItems: [] };
    chunks[cKey].modifiedTiles[`${tx},${ty}`] = tileId;
    broadcastChunkUpdate(cKey);
}

function spawnDroppedItem(baseId, amount, x, y) {
    let tx = Math.floor(x/TILE_SIZE); let ty = Math.floor(y/TILE_SIZE); let cKey = getChunkKey(tx, ty);
    if (!chunks[cKey]) chunks[cKey] = { modifiedTiles: {}, structures: {}, droppedItems: [] };
    chunks[cKey].droppedItems.push({ id: Date.now() + Math.random(), baseId, amount, x, y, expire: Date.now() + 60000 });
    broadcastChunkUpdate(cKey);
}

const wss = new WebSocket.Server({ port: PORT });

wss.on('connection', (ws) => {
    let pid = "p_" + Date.now() + Math.floor(Math.random()*1000);
    let sx = 0, sy = 0; while(getBaseTile(sx, sy) === 0 || TILES[getBaseTile(sx, sy)].solid) { sx++; sy++; }
    
    players[pid] = {
        id: pid, ws: ws, username: "Oyuncu_" + Math.floor(Math.random()*1000), team: null,
        x: sx * TILE_SIZE + TILE_SIZE/2, y: sy * TILE_SIZE + TILE_SIZE/2,
        hp: 100, maxHp: 100, hunger: 100, stamina: 100,
        activeChunks: new Set(), invites: []
    };

    ws.send(JSON.stringify({ type: 'INIT', id: pid, seed: SEED, x: players[pid].x, y: players[pid].y, time: time }));
    broadcastMsg("Sistem", `${players[pid].username} oyuna katıldı. / joined the game.`, 'global');

    ws.on('message', (message) => {
        let data; try { data = JSON.parse(message); } catch(e) { return; }
        let p = players[pid]; if(!p) return;

        if (data.type === 'MOVE') {
            p.x = data.x; p.y = data.y; p.hp = data.hp; p.hunger = data.hunger; p.stamina = data.stamina;
        } 
        else if (data.type === 'REQ_CHUNKS') {
            data.chunks.forEach(cKey => {
                p.activeChunks.add(cKey);
                if (!chunks[cKey]) chunks[cKey] = { modifiedTiles: {}, structures: {}, droppedItems: [] };
                ws.send(JSON.stringify({ type: 'CHUNK_DATA', cKey: cKey, data: chunks[cKey] }));
            });
        }
        else if (data.type === 'DROP_ITEM') {
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
                    }
                }
            }
        }
        else if (data.type === 'GATHER') {
            let tid = getTile(data.tx, data.ty); let tData = TILES[tid];
            if (tData && !tData.isStructure && Utils.distance(p.x/TILE_SIZE, p.y/TILE_SIZE, data.tx, data.ty) <= 4) {
                tData.drops.forEach(d => { 
                    let amount = Math.floor(Math.random() * (d.max - d.min + 1)) + d.min;
                    if(amount > 0) ws.send(JSON.stringify({ type: 'GIVE_ITEM', baseId: d.id, amount: amount })); 
                });
                setTile(data.tx, data.ty, tData.replaces);
            }
        }
        else if (data.type === 'BUILD') {
            let cKey = getChunkKey(data.tx, data.ty); let tKey = `${data.tx},${data.ty}`;
            if (!chunks[cKey]) chunks[cKey] = { modifiedTiles: {}, structures: {}, droppedItems: [] };
            setTile(data.tx, data.ty, data.buildId);
            let bHp = TILES[data.buildId].maxHp * (1 + data.skillLevel * 0.1);
            chunks[cKey].structures[tKey] = { type: data.structureType || 'wall', hp: bHp, maxHp: bHp, ownerId: p.id, ownerTeam: p.team, inventory: {} };
            broadcastChunkUpdate(cKey);
        }
        else if (data.type === 'DEMOLISH') {
            let cKey = getChunkKey(data.tx, data.ty); let tKey = `${data.tx},${data.ty}`;
            let struct = chunks[cKey] ? chunks[cKey].structures[tKey] : null;
            if (struct) {
                if (struct.ownerId === p.id || (p.team && struct.ownerTeam === p.team)) {
                    Object.keys(struct.inventory).forEach(uid => { spawnDroppedItem(struct.inventory[uid].baseId, struct.inventory[uid].amount, data.tx*TILE_SIZE, data.ty*TILE_SIZE); });
                    let tData = TILES[getTile(data.tx, data.ty)];
                    if (tData && tData.drops) { tData.drops.forEach(d => { if(Math.random()<=0.8) ws.send(JSON.stringify({type: 'GIVE_ITEM', baseId: d.id, amount: 1})); }); }
                    setTile(data.tx, data.ty, tData.replaces || 2);
                    delete chunks[cKey].structures[tKey]; broadcastChunkUpdate(cKey);
                }
            }
        }
        else if (data.type === 'ATTACK_ENTITY') {
            let ent = entities[data.entityId];
            if (ent && Utils.distance(p.x, p.y, ent.x, ent.y) <= 80) {
                ent.hp -= data.dmg; ent.state = ENTITY_TYPES[ent.type].type === 'aggressive' ? 'chase' : 'flee'; ent.timer = 5000;
                if (ent.hp <= 0) {
                    ENTITY_TYPES[ent.type].drops.forEach(d => {
                        let amount = Math.floor(Math.random() * (d.max - d.min + 1)) + d.min;
                        if(amount > 0) spawnDroppedItem(d.id, amount, ent.x, ent.y);
                    });
                    delete entities[data.entityId];
                }
            }
        }
        else if (data.type === 'ATTACK_STRUCT') {
            let cKey = getChunkKey(data.tx, data.ty); let tKey = `${data.tx},${data.ty}`;
            let struct = chunks[cKey] ? chunks[cKey].structures[tKey] : null;
            if (struct && Utils.distance(p.x/TILE_SIZE, p.y/TILE_SIZE, data.tx, data.ty) <= 4) {
                if (struct.ownerTeam && p.team === struct.ownerTeam) return; 
                struct.hp -= data.dmg;
                if (struct.hp <= 0) {
                    Object.keys(struct.inventory).forEach(uid => { spawnDroppedItem(struct.inventory[uid].baseId, struct.inventory[uid].amount, data.tx*TILE_SIZE, data.ty*TILE_SIZE); });
                    setTile(data.tx, data.ty, TILES[getTile(data.tx, data.ty)].replaces || 2);
                    delete chunks[cKey].structures[tKey];
                }
                broadcastChunkUpdate(cKey);
            }
        }
        else if (data.type === 'SYNC_CHEST') {
            let cKey = getChunkKey(data.tx, data.ty); let tKey = `${data.tx},${data.ty}`;
            if (chunks[cKey] && chunks[cKey].structures[tKey]) {
                let struct = chunks[cKey].structures[tKey];
                if (struct.ownerTeam && p.team !== struct.ownerTeam && struct.ownerId !== p.id) return; 
                struct.inventory = data.inventory; broadcastChunkUpdate(cKey);
            }
        }
        else if (data.type === 'INTERACT_FARM') {
            let cKey = getChunkKey(data.tx, data.ty); let tKey = `${data.tx},${data.ty}`;
            if (chunks[cKey] && chunks[cKey].structures[tKey] && chunks[cKey].structures[tKey].type === 'farm') {
                if (data.action === 'plant') {
                    setTile(data.tx, data.ty, 13); chunks[cKey].structures[tKey].progress = 0;
                } else if (data.action === 'harvest' && getTile(data.tx, data.ty) === 14) {
                    setTile(data.tx, data.ty, 12); delete chunks[cKey].structures[tKey];
                    ws.send(JSON.stringify({ type: 'GIVE_ITEM', baseId: 'wheat', amount: 2 }));
                    if(Math.random()<0.8) ws.send(JSON.stringify({ type: 'GIVE_ITEM', baseId: 'seed', amount: 1 }));
                }
            }
        }
        else if (data.type === 'INTERACT_DOOR') {
            let tid = getTile(data.tx, data.ty);
            if (tid === 5) setTile(data.tx, data.ty, 16); else if (tid === 6) setTile(data.tx, data.ty, 17);
            else if (tid === 16) setTile(data.tx, data.ty, 5); else if (tid === 17) setTile(data.tx, data.ty, 6);
        }
        else if (data.type === 'CLAN_CREATE') {
            if (p.team) return;
            if (teams[data.name]) { p.ws.send(JSON.stringify({type:'CHAT', sender:'Sistem', msg:'Klan adı mevcut. / Clan name exists.'})); return; }
            teams[data.name] = { name: data.name, owner: p.id, members: [p.id] };
            p.team = data.name;
        }
        else if (data.type === 'CLAN_INVITE') {
            if (!p.team || teams[p.team].owner !== p.id) return;
            let target = Object.values(players).find(pl => pl.username === data.username);
            if (target && !target.team) {
                if (!target.invites.some(i => i.clanName === p.team)) {
                    target.invites.push({ clanName: p.team, senderName: p.username });
                    target.ws.send(JSON.stringify({type:'CHAT', sender:'Sistem', msg:`${p.team} klanından davet. / Invite from ${p.team}.`}));
                }
            }
        }
        else if (data.type === 'CLAN_ACCEPT') {
            let invIndex = p.invites.findIndex(i => i.clanName === data.clanName);
            if (invIndex !== -1) {
                let cName = data.clanName; p.invites.splice(invIndex, 1);
                if (teams[cName] && !p.team) {
                    p.team = cName; teams[cName].members.push(p.id);
                    broadcastMsg("Sistem", `${p.username}, ${cName} klanına katıldı.`, 'global');
                }
            }
        }
        else if (data.type === 'CLAN_DECLINE') {
            p.invites = p.invites.filter(i => i.clanName !== data.clanName);
        }
        else if (data.type === 'CLAN_LEAVE') {
            if (!p.team) return;
            let t = teams[p.team];
            t.members = t.members.filter(id => id !== p.id);
            if (t.members.length === 0) { delete teams[p.team]; } 
            else if (t.owner === p.id) { t.owner = t.members[0]; }
            p.team = null;
        }
        else if (data.type === 'CLAN_KICK') {
            if (!p.team || teams[p.team].owner !== p.id) return;
            let t = teams[p.team];
            if (data.targetId !== p.id) {
                t.members = t.members.filter(id => id !== data.targetId);
                if (players[data.targetId]) {
                    players[data.targetId].team = null;
                    players[data.targetId].ws.send(JSON.stringify({type:'CHAT', sender:'Sistem', msg:`Klandan atıldınız / Kicked from clan.`}));
                }
            }
        }
        else if (data.type === 'CHAT') {
            if (data.msg.startsWith('/')) handleCommand(p, data.msg);
            else {
                if (data.channel === 'team' && p.team) {
                    Object.values(players).forEach(target => { if(target.team === p.team) target.ws.send(JSON.stringify({type:'CHAT', sender: `[Takım] ${p.username}`, msg: data.msg})); });
                } else {
                    broadcastMsg(p.username, data.msg, 'global');
                }
            }
        }
    });

    ws.on('close', () => { 
        broadcastMsg("Sistem", `${players[pid].username} ayrıldı. / left.`, 'global'); 
        if (players[pid].team) {
            let t = teams[players[pid].team];
            if (t) {
                t.members = t.members.filter(id => id !== pid);
                if (t.members.length === 0) { delete teams[players[pid].team]; }
                else if (t.owner === pid) { t.owner = t.members[0]; }
            }
        }
        delete players[pid]; 
    });
});

function handleCommand(p, cmdStr) {
    let args = cmdStr.trim().split(' '); let cmd = args[0].toLowerCase();
    if (cmd === '/isim' || cmd === '/name') {
        if(args[1]) {
            let old = p.username; p.username = args.slice(1).join(' '); 
            broadcastMsg("Sistem", `${old} -> ${p.username}`, 'global');
        }
    }
}

function broadcastMsg(sender, msg, channel) {
    let packet = JSON.stringify({ type: 'CHAT', sender, msg, channel });
    Object.values(players).forEach(p => p.ws.send(packet));
}

function broadcastChunkUpdate(cKey) {
    let packet = JSON.stringify({ type: 'CHUNK_DATA', cKey: cKey, data: chunks[cKey] });
    Object.values(players).forEach(p => { if (p.activeChunks.has(cKey)) p.ws.send(packet); });
}

let lastTick = Date.now();
setInterval(() => {
    let now = Date.now(); let dt = now - lastTick; lastTick = now;
    time += dt * 0.05; if (time > 24000) time = 0;

    Object.keys(chunks).forEach(cKey => {
        let c = chunks[cKey];
        Object.keys(c.structures).forEach(tKey => {
            let s = c.structures[tKey];
            if (s.type === 'farm') {
                s.progress = (s.progress || 0) + dt;
                if (s.progress > 10000) { let [tx, ty] = tKey.split(',').map(Number); setTile(tx, ty, 14); s.progress = 0; }
            }
        });
        for (let i = c.droppedItems.length - 1; i >= 0; i--) { if (now > c.droppedItems[i].expire) { c.droppedItems.splice(i, 1); broadcastChunkUpdate(cKey); } }
    });

    if (Object.keys(entities).length < Object.keys(players).length * 5) {
        let pList = Object.values(players);
        if (pList.length > 0) {
            let rp = pList[Math.floor(Math.random() * pList.length)];
            let angle = Math.random() * Math.PI * 2; let dist = 500 + Math.random() * 300;
            let sx = rp.x + Math.cos(angle) * dist; let sy = rp.y + Math.sin(angle) * dist;
            let stx = Math.floor(sx/TILE_SIZE); let sty = Math.floor(sy/TILE_SIZE);
            if (!TILES[getTile(stx, sty)].solid && getTile(stx, sty) !== 0) {
                let types = ['deer', 'deer', 'wolf', 'bear']; let type = types[Math.floor(Math.random() * types.length)];
                let def = ENTITY_TYPES[type]; let eid = 'e_' + Date.now() + Math.floor(Math.random()*1000);
                entities[eid] = { id: eid, type: type, x: sx, y: sy, hp: def.maxHp, maxHp: def.maxHp, vx: 0, vy: 0, state: 'idle', timer: 0, attackCooldown: 0 };
            }
        }
    }

    Object.values(entities).forEach(ent => {
        let def = ENTITY_TYPES[ent.type]; ent.timer -= dt; ent.attackCooldown = Math.max(0, ent.attackCooldown - dt);
        let nearestP = null; let minDist = Infinity;
        Object.values(players).forEach(p => { let d = Utils.distance(ent.x, ent.y, p.x, p.y); if (d < minDist) { minDist = d; nearestP = p; } });
        
        if (minDist > 2000) { delete entities[ent.id]; return; }

        if (def.type === 'aggressive' && minDist < def.aggroRange && ent.state !== 'flee') ent.state = 'chase';
        else if (ent.state === 'flee' && ent.timer <= 0) ent.state = 'idle';
        else if (ent.state === 'chase' && minDist > def.aggroRange * 1.5) ent.state = 'idle';

        if (ent.state === 'idle' || ent.state === 'wander') {
            if (ent.timer <= 0) {
                if (Math.random() < 0.5) { ent.state = 'wander'; let angle = Math.random() * Math.PI * 2; ent.vx = Math.cos(angle) * def.speed * 0.5; ent.vy = Math.sin(angle) * def.speed * 0.5; ent.timer = 1000 + Math.random() * 2000; } 
                else { ent.state = 'idle'; ent.vx = 0; ent.vy = 0; ent.timer = 1000 + Math.random() * 2000; }
            }
        } else if (ent.state === 'chase' && nearestP) {
            if (minDist < def.attackRange) {
                ent.vx = 0; ent.vy = 0;
                if (ent.attackCooldown <= 0) { nearestP.ws.send(JSON.stringify({type: 'DAMAGE', amount: def.dmg})); ent.attackCooldown = def.attackCooldown; }
            } else {
                let angle = Math.atan2(nearestP.y - ent.y, nearestP.x - ent.x); ent.vx = Math.cos(angle) * def.speed; ent.vy = Math.sin(angle) * def.speed;
            }
        } else if (ent.state === 'flee' && nearestP) {
            let angle = Math.atan2(ent.y - nearestP.y, ent.x - nearestP.x); ent.vx = Math.cos(angle) * def.speed * 1.2; ent.vy = Math.sin(angle) * def.speed * 1.2;
        }

        let currentTid = getTile(Math.floor(ent.x/TILE_SIZE), Math.floor(ent.y/TILE_SIZE));
        let speedMult = (TILES[currentTid] && TILES[currentTid].speedMult) ? TILES[currentTid].speedMult : 1.0;

        let nx = ent.x + (ent.vx * speedMult) * dt; 
        let ny = ent.y + (ent.vy * speedMult) * dt;
        
        if (!TILES[getTile(Math.floor(nx/TILE_SIZE), Math.floor(ent.y/TILE_SIZE))].solid) ent.x = nx; else ent.vx *= -1;
        if (!TILES[getTile(Math.floor(ent.x/TILE_SIZE), Math.floor(ny/TILE_SIZE))].solid) ent.y = ny; else ent.vy *= -1;
    });

    let sPlayers = Object.values(players).map(p => ({ id: p.id, username: p.username, team: p.team, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp }));
    let sEntities = Object.values(entities);
    
    Object.values(players).forEach(p => {
        let teamData = null;
        if (p.team && teams[p.team]) {
            teamData = {
                name: teams[p.team].name,
                owner: teams[p.team].owner,
                members: teams[p.team].members.map(mId => ({ id: mId, username: players[mId]?.username }))
            };
        }
        let statePacket = JSON.stringify({ type: 'SYNC_STATE', time: time, players: sPlayers, entities: sEntities, teamData: teamData, invites: p.invites });
        p.ws.send(statePacket);
    });

}, 50);

console.log(`Sunucu ${PORT} portunda başlatıldı.`);