# Build & Install PICPIO VS Code Extension

## Prerequisites
- Node.js 18+ (https://nodejs.org)
- npm (comes with Node.js)

## Steps

### 1. Install dependencies
```
cd picpio-vscode
npm install
```

### 2. Compile TypeScript
```
npm run compile
```

### 3. Package as .vsix
```
npx vsce package --no-dependencies
```
Creates: `picpio-1.0.0.vsix`

### 4. Install in VS Code
```
code --install-extension picpio-1.0.0.vsix
```
Or: VS Code → Extensions → "..." menu → "Install from VSIX..."

## Development (live reload)
```
npm run watch
```
Then press F5 in VS Code to launch Extension Development Host.
