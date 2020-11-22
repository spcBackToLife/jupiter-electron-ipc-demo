import { app, BrowserWindow } from 'electron';
import path from 'path';
import { Server as ElectronIPCServer } from '../core/electron-main/ipc.electron-main';
import { WindowChannel } from './windowServiceIpc';
import { WindowService } from './windowService';

app.on('ready', () => {
  const electronIpcServer = new ElectronIPCServer();
  electronIpcServer.registerChannel('windowManager',  new WindowChannel(new WindowService()))


  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      nodeIntegration: true
    }
  });

  console.log('render index html:', path.join(__dirname, 'render', 'index.html'));
  win.loadFile(path.join(__dirname, 'render', 'index.html'));
})
