# Commun Server Installation

## System Requirements
* Node.js: Must be version 18.0.0 or higher. (Required to support the built-in fetch function used in the server file).

## Installation
1. Place the main.js and package.json files in the same directory (folder).
2. Open a terminal (command prompt) in this directory.
3. Run the following command to install the necessary libraries (WebSocket):
```bash
npm install
```

## Execution
After the dependencies are installed, enter the following command in the terminal to start the server:
```bash
npm start
```
Alternatively, you can start the server directly using the Node.js command:
```bash
node main.js
```
When the server starts successfully, the log output `[INFO] WebSocket Server initialized and listening on port 8080.` will be displayed in the terminal.
