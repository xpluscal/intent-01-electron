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
  checkMetadataExists: (filePath) => electron.ipcRenderer.invoke("intent:check-metadata-exists", filePath),
  // Git operations
  checkGit: () => electron.ipcRenderer.invoke("intent:check-git"),
  initGit: (refPath) => electron.ipcRenderer.invoke("intent:init-git", refPath),
  installGit: () => electron.ipcRenderer.invoke("intent:install-git"),
  createNextApp: (refPath) => electron.ipcRenderer.invoke("intent:create-next-app", refPath)
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
      <div>INTENT-01</div>
      <div>© 2025 RESONANCE LABS</div>
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXgubWpzIiwic291cmNlcyI6WyIuLi8uLi9lbGVjdHJvbi9wcmVsb2FkL2luZGV4LnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGlwY1JlbmRlcmVyLCBjb250ZXh0QnJpZGdlIH0gZnJvbSAnZWxlY3Ryb24nXG5cbi8vIC0tLS0tLS0tLSBFeHBvc2Ugc29tZSBBUEkgdG8gdGhlIFJlbmRlcmVyIHByb2Nlc3MgLS0tLS0tLS0tXG5jb250ZXh0QnJpZGdlLmV4cG9zZUluTWFpbldvcmxkKCdpcGNSZW5kZXJlcicsIHtcbiAgb24oLi4uYXJnczogUGFyYW1ldGVyczx0eXBlb2YgaXBjUmVuZGVyZXIub24+KSB7XG4gICAgY29uc3QgW2NoYW5uZWwsIGxpc3RlbmVyXSA9IGFyZ3NcbiAgICByZXR1cm4gaXBjUmVuZGVyZXIub24oY2hhbm5lbCwgKGV2ZW50LCAuLi5hcmdzKSA9PiBsaXN0ZW5lcihldmVudCwgLi4uYXJncykpXG4gIH0sXG4gIG9mZiguLi5hcmdzOiBQYXJhbWV0ZXJzPHR5cGVvZiBpcGNSZW5kZXJlci5vZmY+KSB7XG4gICAgY29uc3QgW2NoYW5uZWwsIC4uLm9taXRdID0gYXJnc1xuICAgIHJldHVybiBpcGNSZW5kZXJlci5vZmYoY2hhbm5lbCwgLi4ub21pdClcbiAgfSxcbiAgc2VuZCguLi5hcmdzOiBQYXJhbWV0ZXJzPHR5cGVvZiBpcGNSZW5kZXJlci5zZW5kPikge1xuICAgIGNvbnN0IFtjaGFubmVsLCAuLi5vbWl0XSA9IGFyZ3NcbiAgICByZXR1cm4gaXBjUmVuZGVyZXIuc2VuZChjaGFubmVsLCAuLi5vbWl0KVxuICB9LFxuICBpbnZva2UoLi4uYXJnczogUGFyYW1ldGVyczx0eXBlb2YgaXBjUmVuZGVyZXIuaW52b2tlPikge1xuICAgIGNvbnN0IFtjaGFubmVsLCAuLi5vbWl0XSA9IGFyZ3NcbiAgICByZXR1cm4gaXBjUmVuZGVyZXIuaW52b2tlKGNoYW5uZWwsIC4uLm9taXQpXG4gIH0sXG5cbiAgLy8gWW91IGNhbiBleHBvc2Ugb3RoZXIgQVBUcyB5b3UgbmVlZCBoZXJlLlxuICAvLyAuLi5cbn0pXG5cbi8vIEV4cG9zZSBJbnRlbnQgU2VydmVyIEFQSVxuY29udGV4dEJyaWRnZS5leHBvc2VJbk1haW5Xb3JsZCgnaW50ZW50QVBJJywge1xuICBnZXRTZXJ2ZXJTdGF0dXM6ICgpID0+IGlwY1JlbmRlcmVyLmludm9rZSgnaW50ZW50LXNlcnZlcjpzdGF0dXMnKSxcbiAgLy8gVGhlIHNlcnZlciBydW5zIG9uIGxvY2FsaG9zdDozNDU2LCBzbyB3ZSdsbCBwcm92aWRlIHRoZSBiYXNlIFVSTFxuICBzZXJ2ZXJVcmw6ICdodHRwOi8vbG9jYWxob3N0OjM0NTYnLFxuICBcbiAgLy8gRmlsZSBvcGVyYXRpb25zXG4gIGdldFdvcmtzcGFjZVBhdGg6ICgpID0+IGlwY1JlbmRlcmVyLmludm9rZSgnaW50ZW50OmdldC13b3Jrc3BhY2UtcGF0aCcpLFxuICBsaXN0RmlsZXM6IChkaXJQYXRoOiBzdHJpbmcpID0+IGlwY1JlbmRlcmVyLmludm9rZSgnaW50ZW50Omxpc3QtZmlsZXMnLCBkaXJQYXRoKSxcbiAgcmVhZEZpbGU6IChmaWxlUGF0aDogc3RyaW5nKSA9PiBpcGNSZW5kZXJlci5pbnZva2UoJ2ludGVudDpyZWFkLWZpbGUnLCBmaWxlUGF0aCksXG4gIHdyaXRlRmlsZTogKGZpbGVQYXRoOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZykgPT4gaXBjUmVuZGVyZXIuaW52b2tlKCdpbnRlbnQ6d3JpdGUtZmlsZScsIGZpbGVQYXRoLCBjb250ZW50KSxcbiAgY3JlYXRlRmlsZTogKGZpbGVQYXRoOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZykgPT4gaXBjUmVuZGVyZXIuaW52b2tlKCdpbnRlbnQ6Y3JlYXRlLWZpbGUnLCBmaWxlUGF0aCwgY29udGVudCksXG4gIGRlbGV0ZUZpbGU6IChmaWxlUGF0aDogc3RyaW5nKSA9PiBpcGNSZW5kZXJlci5pbnZva2UoJ2ludGVudDpkZWxldGUtZmlsZScsIGZpbGVQYXRoKSxcbiAgY3JlYXRlRGlyZWN0b3J5OiAoZGlyUGF0aDogc3RyaW5nKSA9PiBpcGNSZW5kZXJlci5pbnZva2UoJ2ludGVudDpjcmVhdGUtZGlyZWN0b3J5JywgZGlyUGF0aCksXG4gIHJlbmFtZUZpbGU6IChvbGRQYXRoOiBzdHJpbmcsIG5ld1BhdGg6IHN0cmluZykgPT4gaXBjUmVuZGVyZXIuaW52b2tlKCdpbnRlbnQ6cmVuYW1lLWZpbGUnLCBvbGRQYXRoLCBuZXdQYXRoKSxcbiAgY29weUZpbGU6IChzb3VyY2VQYXRoOiBzdHJpbmcsIGRlc3RQYXRoOiBzdHJpbmcpID0+IGlwY1JlbmRlcmVyLmludm9rZSgnaW50ZW50OmNvcHktZmlsZScsIHNvdXJjZVBhdGgsIGRlc3RQYXRoKSxcbiAgd3JpdGVGaWxlQnVmZmVyOiAoZmlsZVBhdGg6IHN0cmluZywgYnVmZmVyOiBBcnJheUJ1ZmZlcikgPT4gaXBjUmVuZGVyZXIuaW52b2tlKCdpbnRlbnQ6d3JpdGUtZmlsZS1idWZmZXInLCBmaWxlUGF0aCwgYnVmZmVyKSxcbiAgZ2V0RmlsZVVybDogKGZpbGVQYXRoOiBzdHJpbmcpID0+IGlwY1JlbmRlcmVyLmludm9rZSgnaW50ZW50OmdldC1maWxlLXVybCcsIGZpbGVQYXRoKSxcbiAgXG4gIC8vIFByb2plY3QgbWFuYWdlbWVudFxuICBzY2FuUmVmczogKCkgPT4gaXBjUmVuZGVyZXIuaW52b2tlKCdpbnRlbnQ6c2Nhbi1yZWZzJyksXG4gIGNoZWNrTWV0YWRhdGFFeGlzdHM6IChmaWxlUGF0aDogc3RyaW5nKSA9PiBpcGNSZW5kZXJlci5pbnZva2UoJ2ludGVudDpjaGVjay1tZXRhZGF0YS1leGlzdHMnLCBmaWxlUGF0aCksXG4gIFxuICAvLyBHaXQgb3BlcmF0aW9uc1xuICBjaGVja0dpdDogKCkgPT4gaXBjUmVuZGVyZXIuaW52b2tlKCdpbnRlbnQ6Y2hlY2stZ2l0JyksXG4gIGluaXRHaXQ6IChyZWZQYXRoOiBzdHJpbmcpID0+IGlwY1JlbmRlcmVyLmludm9rZSgnaW50ZW50OmluaXQtZ2l0JywgcmVmUGF0aCksXG4gIGluc3RhbGxHaXQ6ICgpID0+IGlwY1JlbmRlcmVyLmludm9rZSgnaW50ZW50Omluc3RhbGwtZ2l0JyksXG4gIGNyZWF0ZU5leHRBcHA6IChyZWZQYXRoOiBzdHJpbmcpID0+IGlwY1JlbmRlcmVyLmludm9rZSgnaW50ZW50OmNyZWF0ZS1uZXh0LWFwcCcsIHJlZlBhdGgpLFxufSlcblxuLy8gLS0tLS0tLS0tIFByZWxvYWQgc2NyaXB0cyBsb2FkaW5nIC0tLS0tLS0tLVxuZnVuY3Rpb24gZG9tUmVhZHkoY29uZGl0aW9uOiBEb2N1bWVudFJlYWR5U3RhdGVbXSA9IFsnY29tcGxldGUnLCAnaW50ZXJhY3RpdmUnXSkge1xuICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZSA9PiB7XG4gICAgaWYgKGNvbmRpdGlvbi5pbmNsdWRlcyhkb2N1bWVudC5yZWFkeVN0YXRlKSkge1xuICAgICAgcmVzb2x2ZSh0cnVlKVxuICAgIH0gZWxzZSB7XG4gICAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdyZWFkeXN0YXRlY2hhbmdlJywgKCkgPT4ge1xuICAgICAgICBpZiAoY29uZGl0aW9uLmluY2x1ZGVzKGRvY3VtZW50LnJlYWR5U3RhdGUpKSB7XG4gICAgICAgICAgcmVzb2x2ZSh0cnVlKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH1cbiAgfSlcbn1cblxuY29uc3Qgc2FmZURPTSA9IHtcbiAgYXBwZW5kKHBhcmVudDogSFRNTEVsZW1lbnQsIGNoaWxkOiBIVE1MRWxlbWVudCkge1xuICAgIGlmICghQXJyYXkuZnJvbShwYXJlbnQuY2hpbGRyZW4pLmZpbmQoZSA9PiBlID09PSBjaGlsZCkpIHtcbiAgICAgIHJldHVybiBwYXJlbnQuYXBwZW5kQ2hpbGQoY2hpbGQpXG4gICAgfVxuICB9LFxuICByZW1vdmUocGFyZW50OiBIVE1MRWxlbWVudCwgY2hpbGQ6IEhUTUxFbGVtZW50KSB7XG4gICAgaWYgKEFycmF5LmZyb20ocGFyZW50LmNoaWxkcmVuKS5maW5kKGUgPT4gZSA9PT0gY2hpbGQpKSB7XG4gICAgICByZXR1cm4gcGFyZW50LnJlbW92ZUNoaWxkKGNoaWxkKVxuICAgIH1cbiAgfSxcbn1cblxuLyoqXG4gKiBodHRwczovL3RvYmlhc2FobGluLmNvbS9zcGlua2l0XG4gKiBodHRwczovL2Nvbm5vcmF0aGVydG9uLmNvbS9sb2FkZXJzXG4gKiBodHRwczovL3Byb2plY3RzLmx1a2VoYWFzLm1lL2Nzcy1sb2FkZXJzXG4gKiBodHRwczovL21hdGVqa3VzdGVjLmdpdGh1Yi5pby9TcGluVGhhdFNoaXRcbiAqL1xuZnVuY3Rpb24gdXNlTG9hZGluZygpIHtcbiAgY29uc3Qgc3R5bGVDb250ZW50ID0gYFxuQGtleWZyYW1lcyBwdWxzZSB7XG4gIDAlLCAxMDAlIHsgb3BhY2l0eTogMTsgfVxuICA1MCUgeyBvcGFjaXR5OiAwLjU7IH1cbn1cbkBrZXlmcmFtZXMgbG9hZGluZy1kb3RzIHtcbiAgMCUgeyBjb250ZW50OiAnJzsgfVxuICAyNSUgeyBjb250ZW50OiAnLic7IH1cbiAgNTAlIHsgY29udGVudDogJy4uJzsgfVxuICA3NSUgeyBjb250ZW50OiAnLi4uJzsgfVxuICAxMDAlIHsgY29udGVudDogJyc7IH1cbn1cbi5yZXRyby1sb2FkZXIge1xuICBmb250LWZhbWlseTogXCJGaXJhIENvZGVcIiwgbW9ub3NwYWNlO1xuICAvKiBQcmltYXJ5IGNvbG9yIGZyb20gZGFyayB0aGVtZSAqL1xuICBjb2xvcjogb2tsY2goMC43IDAuMTYgNzApO1xuICBmb250LXNpemU6IDExcHg7XG4gIGxpbmUtaGVpZ2h0OiAxMnB4O1xuICB3aGl0ZS1zcGFjZTogcHJlO1xuICBhbmltYXRpb246IHB1bHNlIDJzIGVhc2UtaW4tb3V0IGluZmluaXRlO1xufVxuLmxvYWRpbmctdGV4dCB7XG4gIGZvbnQtZmFtaWx5OiBcIkZpcmEgQ29kZVwiLCBtb25vc3BhY2U7XG4gIC8qIE11dGVkIGZvcmVncm91bmQgZnJvbSBkYXJrIHRoZW1lICovXG4gIGNvbG9yOiBva2xjaCgwLjcgMC4wMyA5MCk7XG4gIGZvbnQtc2l6ZTogMTJweDtcbiAgbWFyZ2luLXRvcDogMTZweDtcbiAgZGlzcGxheTogZmxleDtcbiAgYWxpZ24taXRlbXM6IGNlbnRlcjtcbn1cbi5sb2FkaW5nLXRleHQ6OmFmdGVyIHtcbiAgY29udGVudDogJyc7XG4gIGFuaW1hdGlvbjogbG9hZGluZy1kb3RzIDEuNXMgc3RlcHMoNCwgZW5kKSBpbmZpbml0ZTtcbn1cbi5hcHAtbG9hZGluZy13cmFwIHtcbiAgcG9zaXRpb246IGZpeGVkO1xuICB0b3A6IDA7XG4gIGxlZnQ6IDA7XG4gIHdpZHRoOiAxMDB2dztcbiAgaGVpZ2h0OiAxMDB2aDtcbiAgZGlzcGxheTogZmxleDtcbiAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcbiAgYWxpZ24taXRlbXM6IGNlbnRlcjtcbiAganVzdGlmeS1jb250ZW50OiBjZW50ZXI7XG4gIC8qIEJhY2tncm91bmQgZnJvbSBkYXJrIHRoZW1lICovXG4gIGJhY2tncm91bmQ6IG9rbGNoKDAuMjUgMC4wNCA4MCk7XG4gIHotaW5kZXg6IDk7XG59XG4ubG9hZGluZy1mb290ZXIge1xuICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gIGJvdHRvbTogMjBweDtcbiAgZm9udC1mYW1pbHk6IFwiRmlyYSBDb2RlXCIsIG1vbm9zcGFjZTtcbiAgZm9udC1zaXplOiA5cHg7XG4gIC8qIE11dGVkIGZvcmVncm91bmQgd2l0aCBsb3dlciBvcGFjaXR5ICovXG4gIGNvbG9yOiBva2xjaCgwLjcgMC4wMyA5MCAvIDAuNSk7XG4gIHRleHQtYWxpZ246IGNlbnRlcjtcbiAgbGluZS1oZWlnaHQ6IDEuNDtcbn1cbi8qIFN1cHBvcnQgZm9yIGxpZ2h0IG1vZGUgaWYgc3lzdGVtIHByZWZlcnMgaXQgKi9cbkBtZWRpYSAocHJlZmVycy1jb2xvci1zY2hlbWU6IGxpZ2h0KSB7XG4gIC5yZXRyby1sb2FkZXIge1xuICAgIC8qIFByaW1hcnkgY29sb3IgZnJvbSBsaWdodCB0aGVtZSAqL1xuICAgIGNvbG9yOiBva2xjaCgwLjY1IDAuMTUgNzApO1xuICB9XG4gIC5sb2FkaW5nLXRleHQge1xuICAgIC8qIE11dGVkIGZvcmVncm91bmQgZnJvbSBsaWdodCB0aGVtZSAqL1xuICAgIGNvbG9yOiBva2xjaCgwLjUgMC4wMyA4MCk7XG4gIH1cbiAgLmFwcC1sb2FkaW5nLXdyYXAge1xuICAgIC8qIEJhY2tncm91bmQgZnJvbSBsaWdodCB0aGVtZSAqL1xuICAgIGJhY2tncm91bmQ6IG9rbGNoKDAuOTggMC4wMiA5MCk7XG4gIH1cbiAgLmxvYWRpbmctZm9vdGVyIHtcbiAgICAvKiBNdXRlZCBmb3JlZ3JvdW5kIHdpdGggbG93ZXIgb3BhY2l0eSAqL1xuICAgIGNvbG9yOiBva2xjaCgwLjUgMC4wMyA4MCAvIDAuNSk7XG4gIH1cbn1cbiAgICBgXG4gIGNvbnN0IG9TdHlsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3N0eWxlJylcbiAgY29uc3Qgb0RpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpXG5cbiAgb1N0eWxlLmlkID0gJ2FwcC1sb2FkaW5nLXN0eWxlJ1xuICBvU3R5bGUuaW5uZXJIVE1MID0gc3R5bGVDb250ZW50XG4gIG9EaXYuY2xhc3NOYW1lID0gJ2FwcC1sb2FkaW5nLXdyYXAnXG4gIG9EaXYuaW5uZXJIVE1MID0gYFxuICAgIDxkaXYgY2xhc3M9XCJyZXRyby1sb2FkZXJcIj7ilabilZTilZfilZTilZTilabilZfilZTilZDilZfilZTilZfilZTilZTilabilZcg4pWU4pWQ4pWX4pWmXG7ilZHilZHilZHilZEg4pWRIOKVoOKVoyDilZHilZHilZEg4pWRICDilZEg4pWR4pWRXG7ilanilZ3ilZrilZ0g4pWpIOKVmuKVkOKVneKVneKVmuKVnSDilakgIOKVmuKVkOKVneKVqTwvZGl2PlxuICAgIDxkaXYgY2xhc3M9XCJsb2FkaW5nLXRleHRcIj5JTklUSUFMSVpJTkc8L2Rpdj5cbiAgICA8ZGl2IGNsYXNzPVwibG9hZGluZy1mb290ZXJcIj5cbiAgICAgIDxkaXY+SU5URU5ULTAxPC9kaXY+XG4gICAgICA8ZGl2PsKpIDIwMjUgUkVTT05BTkNFIExBQlM8L2Rpdj5cbiAgICA8L2Rpdj5cbiAgYFxuXG4gIHJldHVybiB7XG4gICAgYXBwZW5kTG9hZGluZygpIHtcbiAgICAgIHNhZmVET00uYXBwZW5kKGRvY3VtZW50LmhlYWQsIG9TdHlsZSlcbiAgICAgIHNhZmVET00uYXBwZW5kKGRvY3VtZW50LmJvZHksIG9EaXYpXG4gICAgfSxcbiAgICByZW1vdmVMb2FkaW5nKCkge1xuICAgICAgc2FmZURPTS5yZW1vdmUoZG9jdW1lbnQuaGVhZCwgb1N0eWxlKVxuICAgICAgc2FmZURPTS5yZW1vdmUoZG9jdW1lbnQuYm9keSwgb0RpdilcbiAgICB9LFxuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgeyBhcHBlbmRMb2FkaW5nLCByZW1vdmVMb2FkaW5nIH0gPSB1c2VMb2FkaW5nKClcbmRvbVJlYWR5KCkudGhlbihhcHBlbmRMb2FkaW5nKVxuXG53aW5kb3cub25tZXNzYWdlID0gKGV2KSA9PiB7XG4gIGV2LmRhdGEucGF5bG9hZCA9PT0gJ3JlbW92ZUxvYWRpbmcnICYmIHJlbW92ZUxvYWRpbmcoKVxufVxuXG5zZXRUaW1lb3V0KHJlbW92ZUxvYWRpbmcsIDQ5OTkpIl0sIm5hbWVzIjpbImNvbnRleHRCcmlkZ2UiLCJpcGNSZW5kZXJlciIsImFyZ3MiXSwibWFwcGluZ3MiOiI7O0FBR0FBLFNBQUFBLGNBQWMsa0JBQWtCLGVBQWU7QUFBQSxFQUM3QyxNQUFNLE1BQXlDO0FBQzdDLFVBQU0sQ0FBQyxTQUFTLFFBQVEsSUFBSTtBQUM1QixXQUFPQyxxQkFBWSxHQUFHLFNBQVMsQ0FBQyxVQUFVQyxVQUFTLFNBQVMsT0FBTyxHQUFHQSxLQUFJLENBQUM7QUFBQSxFQUM3RTtBQUFBLEVBQ0EsT0FBTyxNQUEwQztBQUMvQyxVQUFNLENBQUMsU0FBUyxHQUFHLElBQUksSUFBSTtBQUMzQixXQUFPRCxxQkFBWSxJQUFJ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
