"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args) {
    const [channel, listener] = args;
    return electron.ipcRenderer.on(channel, (event, ...args2) => listener(event, ...args2));
  },
  off(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.off(channel, ...omit);
  },
  send(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.send(channel, ...omit);
  },
  invoke(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.invoke(channel, ...omit);
  }
  // You can expose other APTs you need here.
  // ...
});
electron.contextBridge.exposeInMainWorld("intentAPI", {
  getServerStatus: () => electron.ipcRenderer.invoke("intent-server:status"),
  // The server runs on localhost:3456, so we'll provide the base URL
  serverUrl: "http://localhost:3456",
  // File operations
  getWorkspacePath: () => electron.ipcRenderer.invoke("intent:get-workspace-path"),
  listFiles: (dirPath) => electron.ipcRenderer.invoke("intent:list-files", dirPath),
  readFile: (filePath) => electron.ipcRenderer.invoke("intent:read-file", filePath),
  writeFile: (filePath, content) => electron.ipcRenderer.invoke("intent:write-file", filePath, content),
  createFile: (filePath, content) => electron.ipcRenderer.invoke("intent:create-file", filePath, content),
  deleteFile: (filePath) => electron.ipcRenderer.invoke("intent:delete-file", filePath),
  createDirectory: (dirPath) => electron.ipcRenderer.invoke("intent:create-directory", dirPath),
  renameFile: (oldPath, newPath) => electron.ipcRenderer.invoke("intent:rename-file", oldPath, newPath),
  copyFile: (sourcePath, destPath) => electron.ipcRenderer.invoke("intent:copy-file", sourcePath, destPath),
  writeFileBuffer: (filePath, buffer) => electron.ipcRenderer.invoke("intent:write-file-buffer", filePath, buffer),
  getFileUrl: (filePath) => electron.ipcRenderer.invoke("intent:get-file-url", filePath),
  // Project management
  scanRefs: () => electron.ipcRenderer.invoke("intent:scan-refs"),
  checkMetadataExists: (filePath) => electron.ipcRenderer.invoke("intent:check-metadata-exists", filePath)
});
function domReady(condition = ["complete", "interactive"]) {
  return new Promise((resolve) => {
    if (condition.includes(document.readyState)) {
      resolve(true);
    } else {
      document.addEventListener("readystatechange", () => {
        if (condition.includes(document.readyState)) {
          resolve(true);
        }
      });
    }
  });
}
const safeDOM = {
  append(parent, child) {
    if (!Array.from(parent.children).find((e) => e === child)) {
      return parent.appendChild(child);
    }
  },
  remove(parent, child) {
    if (Array.from(parent.children).find((e) => e === child)) {
      return parent.removeChild(child);
    }
  }
};
function useLoading() {
  const styleContent = `
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
@keyframes loading-dots {
  0% { content: ''; }
  25% { content: '.'; }
  50% { content: '..'; }
  75% { content: '...'; }
  100% { content: ''; }
}
.retro-loader {
  font-family: "Fira Code", monospace;
  /* Primary color from dark theme */
  color: oklch(0.7 0.16 70);
  font-size: 11px;
  line-height: 12px;
  white-space: pre;
  animation: pulse 2s ease-in-out infinite;
}
.loading-text {
  font-family: "Fira Code", monospace;
  /* Muted foreground from dark theme */
  color: oklch(0.7 0.03 90);
  font-size: 12px;
  margin-top: 16px;
  display: flex;
  align-items: center;
}
.loading-text::after {
  content: '';
  animation: loading-dots 1.5s steps(4, end) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /* Background from dark theme */
  background: oklch(0.25 0.04 80);
  z-index: 9;
}
.loading-footer {
  position: absolute;
  bottom: 20px;
  font-family: "Fira Code", monospace;
  font-size: 9px;
  /* Muted foreground with lower opacity */
  color: oklch(0.7 0.03 90 / 0.5);
  text-align: center;
  line-height: 1.4;
}
/* Support for light mode if system prefers it */
@media (prefers-color-scheme: light) {
  .retro-loader {
    /* Primary color from light theme */
    color: oklch(0.65 0.15 70);
  }
  .loading-text {
    /* Muted foreground from light theme */
    color: oklch(0.5 0.03 80);
  }
  .app-loading-wrap {
    /* Background from light theme */
    background: oklch(0.98 0.02 90);
  }
  .loading-footer {
    /* Muted foreground with lower opacity */
    color: oklch(0.5 0.03 80 / 0.5);
  }
}
    `;
  const oStyle = document.createElement("style");
  const oDiv = document.createElement("div");
  oStyle.id = "app-loading-style";
  oStyle.innerHTML = styleContent;
  oDiv.className = "app-loading-wrap";
  oDiv.innerHTML = `
    <div class="retro-loader">╦╔╗╔╔╦╗╔═╗╔╗╔╔╦╗ ╔═╗╦
║║║║ ║ ╠╣ ║║║ ║  ║ ║║
╩╝╚╝ ╩ ╚═╝╝╚╝ ╩  ╚═╝╩</div>
    <div class="loading-text">INITIALIZING</div>
    <div class="loading-footer">
      <div>INTENT WORKER v1.0.0</div>
      <div>© 2024 RESONANCE LABS</div>
    </div>
  `;
  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle);
      safeDOM.append(document.body, oDiv);
    },
    removeLoading() {
      safeDOM.remove(document.head, oStyle);
      safeDOM.remove(document.body, oDiv);
    }
  };
}
const { appendLoading, removeLoading } = useLoading();
domReady().then(appendLoading);
window.onmessage = (ev) => {
  ev.data.payload === "removeLoading" && removeLoading();
};
setTimeout(removeLoading, 4999);
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXgubWpzIiwic291cmNlcyI6WyIuLi8uLi9lbGVjdHJvbi9wcmVsb2FkL2luZGV4LnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGlwY1JlbmRlcmVyLCBjb250ZXh0QnJpZGdlIH0gZnJvbSAnZWxlY3Ryb24nXG5cbi8vIC0tLS0tLS0tLSBFeHBvc2Ugc29tZSBBUEkgdG8gdGhlIFJlbmRlcmVyIHByb2Nlc3MgLS0tLS0tLS0tXG5jb250ZXh0QnJpZGdlLmV4cG9zZUluTWFpbldvcmxkKCdpcGNSZW5kZXJlcicsIHtcbiAgb24oLi4uYXJnczogUGFyYW1ldGVyczx0eXBlb2YgaXBjUmVuZGVyZXIub24+KSB7XG4gICAgY29uc3QgW2NoYW5uZWwsIGxpc3RlbmVyXSA9IGFyZ3NcbiAgICByZXR1cm4gaXBjUmVuZGVyZXIub24oY2hhbm5lbCwgKGV2ZW50LCAuLi5hcmdzKSA9PiBsaXN0ZW5lcihldmVudCwgLi4uYXJncykpXG4gIH0sXG4gIG9mZiguLi5hcmdzOiBQYXJhbWV0ZXJzPHR5cGVvZiBpcGNSZW5kZXJlci5vZmY+KSB7XG4gICAgY29uc3QgW2NoYW5uZWwsIC4uLm9taXRdID0gYXJnc1xuICAgIHJldHVybiBpcGNSZW5kZXJlci5vZmYoY2hhbm5lbCwgLi4ub21pdClcbiAgfSxcbiAgc2VuZCguLi5hcmdzOiBQYXJhbWV0ZXJzPHR5cGVvZiBpcGNSZW5kZXJlci5zZW5kPikge1xuICAgIGNvbnN0IFtjaGFubmVsLCAuLi5vbWl0XSA9IGFyZ3NcbiAgICByZXR1cm4gaXBjUmVuZGVyZXIuc2VuZChjaGFubmVsLCAuLi5vbWl0KVxuICB9LFxuICBpbnZva2UoLi4uYXJnczogUGFyYW1ldGVyczx0eXBlb2YgaXBjUmVuZGVyZXIuaW52b2tlPikge1xuICAgIGNvbnN0IFtjaGFubmVsLCAuLi5vbWl0XSA9IGFyZ3NcbiAgICByZXR1cm4gaXBjUmVuZGVyZXIuaW52b2tlKGNoYW5uZWwsIC4uLm9taXQpXG4gIH0sXG5cbiAgLy8gWW91IGNhbiBleHBvc2Ugb3RoZXIgQVBUcyB5b3UgbmVlZCBoZXJlLlxuICAvLyAuLi5cbn0pXG5cbi8vIEV4cG9zZSBJbnRlbnQgU2VydmVyIEFQSVxuY29udGV4dEJyaWRnZS5leHBvc2VJbk1haW5Xb3JsZCgnaW50ZW50QVBJJywge1xuICBnZXRTZXJ2ZXJTdGF0dXM6ICgpID0+IGlwY1JlbmRlcmVyLmludm9rZSgnaW50ZW50LXNlcnZlcjpzdGF0dXMnKSxcbiAgLy8gVGhlIHNlcnZlciBydW5zIG9uIGxvY2FsaG9zdDozNDU2LCBzbyB3ZSdsbCBwcm92aWRlIHRoZSBiYXNlIFVSTFxuICBzZXJ2ZXJVcmw6ICdodHRwOi8vbG9jYWxob3N0OjM0NTYnLFxuICBcbiAgLy8gRmlsZSBvcGVyYXRpb25zXG4gIGdldFdvcmtzcGFjZVBhdGg6ICgpID0+IGlwY1JlbmRlcmVyLmludm9rZSgnaW50ZW50OmdldC13b3Jrc3BhY2UtcGF0aCcpLFxuICBsaXN0RmlsZXM6IChkaXJQYXRoOiBzdHJpbmcpID0+IGlwY1JlbmRlcmVyLmludm9rZSgnaW50ZW50Omxpc3QtZmlsZXMnLCBkaXJQYXRoKSxcbiAgcmVhZEZpbGU6IChmaWxlUGF0aDogc3RyaW5nKSA9PiBpcGNSZW5kZXJlci5pbnZva2UoJ2ludGVudDpyZWFkLWZpbGUnLCBmaWxlUGF0aCksXG4gIHdyaXRlRmlsZTogKGZpbGVQYXRoOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZykgPT4gaXBjUmVuZGVyZXIuaW52b2tlKCdpbnRlbnQ6d3JpdGUtZmlsZScsIGZpbGVQYXRoLCBjb250ZW50KSxcbiAgY3JlYXRlRmlsZTogKGZpbGVQYXRoOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZykgPT4gaXBjUmVuZGVyZXIuaW52b2tlKCdpbnRlbnQ6Y3JlYXRlLWZpbGUnLCBmaWxlUGF0aCwgY29udGVudCksXG4gIGRlbGV0ZUZpbGU6IChmaWxlUGF0aDogc3RyaW5nKSA9PiBpcGNSZW5kZXJlci5pbnZva2UoJ2ludGVudDpkZWxldGUtZmlsZScsIGZpbGVQYXRoKSxcbiAgY3JlYXRlRGlyZWN0b3J5OiAoZGlyUGF0aDogc3RyaW5nKSA9PiBpcGNSZW5kZXJlci5pbnZva2UoJ2ludGVudDpjcmVhdGUtZGlyZWN0b3J5JywgZGlyUGF0aCksXG4gIHJlbmFtZUZpbGU6IChvbGRQYXRoOiBzdHJpbmcsIG5ld1BhdGg6IHN0cmluZykgPT4gaXBjUmVuZGVyZXIuaW52b2tlKCdpbnRlbnQ6cmVuYW1lLWZpbGUnLCBvbGRQYXRoLCBuZXdQYXRoKSxcbiAgY29weUZpbGU6IChzb3VyY2VQYXRoOiBzdHJpbmcsIGRlc3RQYXRoOiBzdHJpbmcpID0+IGlwY1JlbmRlcmVyLmludm9rZSgnaW50ZW50OmNvcHktZmlsZScsIHNvdXJjZVBhdGgsIGRlc3RQYXRoKSxcbiAgd3JpdGVGaWxlQnVmZmVyOiAoZmlsZVBhdGg6IHN0cmluZywgYnVmZmVyOiBBcnJheUJ1ZmZlcikgPT4gaXBjUmVuZGVyZXIuaW52b2tlKCdpbnRlbnQ6d3JpdGUtZmlsZS1idWZmZXInLCBmaWxlUGF0aCwgYnVmZmVyKSxcbiAgZ2V0RmlsZVVybDogKGZpbGVQYXRoOiBzdHJpbmcpID0+IGlwY1JlbmRlcmVyLmludm9rZSgnaW50ZW50OmdldC1maWxlLXVybCcsIGZpbGVQYXRoKSxcbiAgXG4gIC8vIFByb2plY3QgbWFuYWdlbWVudFxuICBzY2FuUmVmczogKCkgPT4gaXBjUmVuZGVyZXIuaW52b2tlKCdpbnRlbnQ6c2Nhbi1yZWZzJyksXG4gIGNoZWNrTWV0YWRhdGFFeGlzdHM6IChmaWxlUGF0aDogc3RyaW5nKSA9PiBpcGNSZW5kZXJlci5pbnZva2UoJ2ludGVudDpjaGVjay1tZXRhZGF0YS1leGlzdHMnLCBmaWxlUGF0aCksXG59KVxuXG4vLyAtLS0tLS0tLS0gUHJlbG9hZCBzY3JpcHRzIGxvYWRpbmcgLS0tLS0tLS0tXG5mdW5jdGlvbiBkb21SZWFkeShjb25kaXRpb246IERvY3VtZW50UmVhZHlTdGF0ZVtdID0gWydjb21wbGV0ZScsICdpbnRlcmFjdGl2ZSddKSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHtcbiAgICBpZiAoY29uZGl0aW9uLmluY2x1ZGVzKGRvY3VtZW50LnJlYWR5U3RhdGUpKSB7XG4gICAgICByZXNvbHZlKHRydWUpXG4gICAgfSBlbHNlIHtcbiAgICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ3JlYWR5c3RhdGVjaGFuZ2UnLCAoKSA9PiB7XG4gICAgICAgIGlmIChjb25kaXRpb24uaW5jbHVkZXMoZG9jdW1lbnQucmVhZHlTdGF0ZSkpIHtcbiAgICAgICAgICByZXNvbHZlKHRydWUpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfVxuICB9KVxufVxuXG5jb25zdCBzYWZlRE9NID0ge1xuICBhcHBlbmQocGFyZW50OiBIVE1MRWxlbWVudCwgY2hpbGQ6IEhUTUxFbGVtZW50KSB7XG4gICAgaWYgKCFBcnJheS5mcm9tKHBhcmVudC5jaGlsZHJlbikuZmluZChlID0+IGUgPT09IGNoaWxkKSkge1xuICAgICAgcmV0dXJuIHBhcmVudC5hcHBlbmRDaGlsZChjaGlsZClcbiAgICB9XG4gIH0sXG4gIHJlbW92ZShwYXJlbnQ6IEhUTUxFbGVtZW50LCBjaGlsZDogSFRNTEVsZW1lbnQpIHtcbiAgICBpZiAoQXJyYXkuZnJvbShwYXJlbnQuY2hpbGRyZW4pLmZpbmQoZSA9PiBlID09PSBjaGlsZCkpIHtcbiAgICAgIHJldHVybiBwYXJlbnQucmVtb3ZlQ2hpbGQoY2hpbGQpXG4gICAgfVxuICB9LFxufVxuXG4vKipcbiAqIGh0dHBzOi8vdG9iaWFzYWhsaW4uY29tL3NwaW5raXRcbiAqIGh0dHBzOi8vY29ubm9yYXRoZXJ0b24uY29tL2xvYWRlcnNcbiAqIGh0dHBzOi8vcHJvamVjdHMubHVrZWhhYXMubWUvY3NzLWxvYWRlcnNcbiAqIGh0dHBzOi8vbWF0ZWprdXN0ZWMuZ2l0aHViLmlvL1NwaW5UaGF0U2hpdFxuICovXG5mdW5jdGlvbiB1c2VMb2FkaW5nKCkge1xuICBjb25zdCBzdHlsZUNvbnRlbnQgPSBgXG5Aa2V5ZnJhbWVzIHB1bHNlIHtcbiAgMCUsIDEwMCUgeyBvcGFjaXR5OiAxOyB9XG4gIDUwJSB7IG9wYWNpdHk6IDAuNTsgfVxufVxuQGtleWZyYW1lcyBsb2FkaW5nLWRvdHMge1xuICAwJSB7IGNvbnRlbnQ6ICcnOyB9XG4gIDI1JSB7IGNvbnRlbnQ6ICcuJzsgfVxuICA1MCUgeyBjb250ZW50OiAnLi4nOyB9XG4gIDc1JSB7IGNvbnRlbnQ6ICcuLi4nOyB9XG4gIDEwMCUgeyBjb250ZW50OiAnJzsgfVxufVxuLnJldHJvLWxvYWRlciB7XG4gIGZvbnQtZmFtaWx5OiBcIkZpcmEgQ29kZVwiLCBtb25vc3BhY2U7XG4gIC8qIFByaW1hcnkgY29sb3IgZnJvbSBkYXJrIHRoZW1lICovXG4gIGNvbG9yOiBva2xjaCgwLjcgMC4xNiA3MCk7XG4gIGZvbnQtc2l6ZTogMTFweDtcbiAgbGluZS1oZWlnaHQ6IDEycHg7XG4gIHdoaXRlLXNwYWNlOiBwcmU7XG4gIGFuaW1hdGlvbjogcHVsc2UgMnMgZWFzZS1pbi1vdXQgaW5maW5pdGU7XG59XG4ubG9hZGluZy10ZXh0IHtcbiAgZm9udC1mYW1pbHk6IFwiRmlyYSBDb2RlXCIsIG1vbm9zcGFjZTtcbiAgLyogTXV0ZWQgZm9yZWdyb3VuZCBmcm9tIGRhcmsgdGhlbWUgKi9cbiAgY29sb3I6IG9rbGNoKDAuNyAwLjAzIDkwKTtcbiAgZm9udC1zaXplOiAxMnB4O1xuICBtYXJnaW4tdG9wOiAxNnB4O1xuICBkaXNwbGF5OiBmbGV4O1xuICBhbGlnbi1pdGVtczogY2VudGVyO1xufVxuLmxvYWRpbmctdGV4dDo6YWZ0ZXIge1xuICBjb250ZW50OiAnJztcbiAgYW5pbWF0aW9uOiBsb2FkaW5nLWRvdHMgMS41cyBzdGVwcyg0LCBlbmQpIGluZmluaXRlO1xufVxuLmFwcC1sb2FkaW5nLXdyYXAge1xuICBwb3NpdGlvbjogZml4ZWQ7XG4gIHRvcDogMDtcbiAgbGVmdDogMDtcbiAgd2lkdGg6IDEwMHZ3O1xuICBoZWlnaHQ6IDEwMHZoO1xuICBkaXNwbGF5OiBmbGV4O1xuICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xuICBhbGlnbi1pdGVtczogY2VudGVyO1xuICBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjtcbiAgLyogQmFja2dyb3VuZCBmcm9tIGRhcmsgdGhlbWUgKi9cbiAgYmFja2dyb3VuZDogb2tsY2goMC4yNSAwLjA0IDgwKTtcbiAgei1pbmRleDogOTtcbn1cbi5sb2FkaW5nLWZvb3RlciB7XG4gIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgYm90dG9tOiAyMHB4O1xuICBmb250LWZhbWlseTogXCJGaXJhIENvZGVcIiwgbW9ub3NwYWNlO1xuICBmb250LXNpemU6IDlweDtcbiAgLyogTXV0ZWQgZm9yZWdyb3VuZCB3aXRoIGxvd2VyIG9wYWNpdHkgKi9cbiAgY29sb3I6IG9rbGNoKDAuNyAwLjAzIDkwIC8gMC41KTtcbiAgdGV4dC1hbGlnbjogY2VudGVyO1xuICBsaW5lLWhlaWdodDogMS40O1xufVxuLyogU3VwcG9ydCBmb3IgbGlnaHQgbW9kZSBpZiBzeXN0ZW0gcHJlZmVycyBpdCAqL1xuQG1lZGlhIChwcmVmZXJzLWNvbG9yLXNjaGVtZTogbGlnaHQpIHtcbiAgLnJldHJvLWxvYWRlciB7XG4gICAgLyogUHJpbWFyeSBjb2xvciBmcm9tIGxpZ2h0IHRoZW1lICovXG4gICAgY29sb3I6IG9rbGNoKDAuNjUgMC4xNSA3MCk7XG4gIH1cbiAgLmxvYWRpbmctdGV4dCB7XG4gICAgLyogTXV0ZWQgZm9yZWdyb3VuZCBmcm9tIGxpZ2h0IHRoZW1lICovXG4gICAgY29sb3I6IG9rbGNoKDAuNSAwLjAzIDgwKTtcbiAgfVxuICAuYXBwLWxvYWRpbmctd3JhcCB7XG4gICAgLyogQmFja2dyb3VuZCBmcm9tIGxpZ2h0IHRoZW1lICovXG4gICAgYmFja2dyb3VuZDogb2tsY2goMC45OCAwLjAyIDkwKTtcbiAgfVxuICAubG9hZGluZy1mb290ZXIge1xuICAgIC8qIE11dGVkIGZvcmVncm91bmQgd2l0aCBsb3dlciBvcGFjaXR5ICovXG4gICAgY29sb3I6IG9rbGNoKDAuNSAwLjAzIDgwIC8gMC41KTtcbiAgfVxufVxuICAgIGBcbiAgY29uc3Qgb1N0eWxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3R5bGUnKVxuICBjb25zdCBvRGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JylcblxuICBvU3R5bGUuaWQgPSAnYXBwLWxvYWRpbmctc3R5bGUnXG4gIG9TdHlsZS5pbm5lckhUTUwgPSBzdHlsZUNvbnRlbnRcbiAgb0Rpdi5jbGFzc05hbWUgPSAnYXBwLWxvYWRpbmctd3JhcCdcbiAgb0Rpdi5pbm5lckhUTUwgPSBgXG4gICAgPGRpdiBjbGFzcz1cInJldHJvLWxvYWRlclwiPuKVpuKVlOKVl+KVlOKVlOKVpuKVl+KVlOKVkOKVl+KVlOKVl+KVlOKVlOKVpuKVlyDilZTilZDilZfilaZcbuKVkeKVkeKVkeKVkSDilZEg4pWg4pWjIOKVkeKVkeKVkSDilZEgIOKVkSDilZHilZFcbuKVqeKVneKVmuKVnSDilakg4pWa4pWQ4pWd4pWd4pWa4pWdIOKVqSAg4pWa4pWQ4pWd4pWpPC9kaXY+XG4gICAgPGRpdiBjbGFzcz1cImxvYWRpbmctdGV4dFwiPklOSVRJQUxJWklORzwvZGl2PlxuICAgIDxkaXYgY2xhc3M9XCJsb2FkaW5nLWZvb3RlclwiPlxuICAgICAgPGRpdj5JTlRFTlQgV09SS0VSIHYxLjAuMDwvZGl2PlxuICAgICAgPGRpdj7CqSAyMDI0IFJFU09OQU5DRSBMQUJTPC9kaXY+XG4gICAgPC9kaXY+XG4gIGBcblxuICByZXR1cm4ge1xuICAgIGFwcGVuZExvYWRpbmcoKSB7XG4gICAgICBzYWZlRE9NLmFwcGVuZChkb2N1bWVudC5oZWFkLCBvU3R5bGUpXG4gICAgICBzYWZlRE9NLmFwcGVuZChkb2N1bWVudC5ib2R5LCBvRGl2KVxuICAgIH0sXG4gICAgcmVtb3ZlTG9hZGluZygpIHtcbiAgICAgIHNhZmVET00ucmVtb3ZlKGRvY3VtZW50LmhlYWQsIG9TdHlsZSlcbiAgICAgIHNhZmVET00ucmVtb3ZlKGRvY3VtZW50LmJvZHksIG9EaXYpXG4gICAgfSxcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IHsgYXBwZW5kTG9hZGluZywgcmVtb3ZlTG9hZGluZyB9ID0gdXNlTG9hZGluZygpXG5kb21SZWFkeSgpLnRoZW4oYXBwZW5kTG9hZGluZylcblxud2luZG93Lm9ubWVzc2FnZSA9IChldikgPT4ge1xuICBldi5kYXRhLnBheWxvYWQgPT09ICdyZW1vdmVMb2FkaW5nJyAmJiByZW1vdmVMb2FkaW5nKClcbn1cblxuc2V0VGltZW91dChyZW1vdmVMb2FkaW5nLCA0OTk5KSJdLCJuYW1lcyI6WyJjb250ZXh0QnJpZGdlIiwiaXBjUmVuZGVyZXIiLCJhcmdzIl0sIm1hcHBpbmdzIjoiOztBQUdBQSxTQUFBQSxjQUFjLGtCQUFrQixlQUFlO0FBQUEsRUFDN0MsTUFBTSxNQUF5QztBQUM3QyxVQUFNLENBQUMsU0FBUyxRQUFRLElBQUk7QUFDNUIsV0FBT0MscUJBQVksR0FBRyxTQUFTLENBQUMsVUFBVUMsVUFBUyxTQUFTLE9BQU8sR0FBR0EsS0FBSSxDQUFDO0FBQUEsRUFDN0U7QUFBQSxFQUNBLE9BQU8sTUFBMEM7QUFDL0MsVUFBTSxDQUFDLFNBQVMsR0FBRyxJQUFJLElBQUk7QUFDM0IsV0FBT0QscUJBQVksSUFBSSxTQUFTLEdBQUcsSUFBSTtBQUFBLEVBQ3pDO0FBQUEsRUFDQSxRQUFRLE1BQTJDO0FBQ2pELFVBQU0sQ0FBQyxTQUFTLEdBQUcsSUFBSSxJQUFJO0FBQzNCLFdBQU9BLHFCQUFZLEtBQUssU0FBUyxHQUFHLElBQUk7QUFBQSxFQUMxQztBQUFBLEVBQ0EsVUFBVSxNQUE2QztBQUNyRCxVQUFNLENBQUMsU0FBUyxHQUFHLElBQUksSUFBSTtBQUMzQixXQUFPQSxxQkFBWSxPQUFPLFNBQVMsR0FBRyxJQUFJO0FBQUEsRUFDNUM7QUFBQTtBQUFBO0FBSUYsQ0FBQztBQUdERCxTQUFBQSxjQUFjLGtCQUFrQixhQUFhO0FBQUEsRUFDM0MsaUJBQWlCLE1BQU1D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
