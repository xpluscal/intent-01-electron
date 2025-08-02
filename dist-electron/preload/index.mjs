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
  const className = `loaders-css__square-spin`;
  const styleContent = `
@keyframes square-spin {
  25% { transform: perspective(100px) rotateX(180deg) rotateY(0); }
  50% { transform: perspective(100px) rotateX(180deg) rotateY(180deg); }
  75% { transform: perspective(100px) rotateX(0) rotateY(180deg); }
  100% { transform: perspective(100px) rotateX(0) rotateY(0); }
}
.${className} > div {
  animation-fill-mode: both;
  width: 50px;
  height: 50px;
  background: #fff;
  animation: square-spin 3s 0s cubic-bezier(0.09, 0.57, 0.49, 0.9) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #282c34;
  z-index: 9;
}
    `;
  const oStyle = document.createElement("style");
  const oDiv = document.createElement("div");
  oStyle.id = "app-loading-style";
  oStyle.innerHTML = styleContent;
  oDiv.className = "app-loading-wrap";
  oDiv.innerHTML = `<div class="${className}"><div></div></div>`;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXgubWpzIiwic291cmNlcyI6WyIuLi8uLi9lbGVjdHJvbi9wcmVsb2FkL2luZGV4LnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGlwY1JlbmRlcmVyLCBjb250ZXh0QnJpZGdlIH0gZnJvbSAnZWxlY3Ryb24nXG5cbi8vIC0tLS0tLS0tLSBFeHBvc2Ugc29tZSBBUEkgdG8gdGhlIFJlbmRlcmVyIHByb2Nlc3MgLS0tLS0tLS0tXG5jb250ZXh0QnJpZGdlLmV4cG9zZUluTWFpbldvcmxkKCdpcGNSZW5kZXJlcicsIHtcbiAgb24oLi4uYXJnczogUGFyYW1ldGVyczx0eXBlb2YgaXBjUmVuZGVyZXIub24+KSB7XG4gICAgY29uc3QgW2NoYW5uZWwsIGxpc3RlbmVyXSA9IGFyZ3NcbiAgICByZXR1cm4gaXBjUmVuZGVyZXIub24oY2hhbm5lbCwgKGV2ZW50LCAuLi5hcmdzKSA9PiBsaXN0ZW5lcihldmVudCwgLi4uYXJncykpXG4gIH0sXG4gIG9mZiguLi5hcmdzOiBQYXJhbWV0ZXJzPHR5cGVvZiBpcGNSZW5kZXJlci5vZmY+KSB7XG4gICAgY29uc3QgW2NoYW5uZWwsIC4uLm9taXRdID0gYXJnc1xuICAgIHJldHVybiBpcGNSZW5kZXJlci5vZmYoY2hhbm5lbCwgLi4ub21pdClcbiAgfSxcbiAgc2VuZCguLi5hcmdzOiBQYXJhbWV0ZXJzPHR5cGVvZiBpcGNSZW5kZXJlci5zZW5kPikge1xuICAgIGNvbnN0IFtjaGFubmVsLCAuLi5vbWl0XSA9IGFyZ3NcbiAgICByZXR1cm4gaXBjUmVuZGVyZXIuc2VuZChjaGFubmVsLCAuLi5vbWl0KVxuICB9LFxuICBpbnZva2UoLi4uYXJnczogUGFyYW1ldGVyczx0eXBlb2YgaXBjUmVuZGVyZXIuaW52b2tlPikge1xuICAgIGNvbnN0IFtjaGFubmVsLCAuLi5vbWl0XSA9IGFyZ3NcbiAgICByZXR1cm4gaXBjUmVuZGVyZXIuaW52b2tlKGNoYW5uZWwsIC4uLm9taXQpXG4gIH0sXG5cbiAgLy8gWW91IGNhbiBleHBvc2Ugb3RoZXIgQVBUcyB5b3UgbmVlZCBoZXJlLlxuICAvLyAuLi5cbn0pXG5cbi8vIC0tLS0tLS0tLSBQcmVsb2FkIHNjcmlwdHMgbG9hZGluZyAtLS0tLS0tLS1cbmZ1bmN0aW9uIGRvbVJlYWR5KGNvbmRpdGlvbjogRG9jdW1lbnRSZWFkeVN0YXRlW10gPSBbJ2NvbXBsZXRlJywgJ2ludGVyYWN0aXZlJ10pIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKHJlc29sdmUgPT4ge1xuICAgIGlmIChjb25kaXRpb24uaW5jbHVkZXMoZG9jdW1lbnQucmVhZHlTdGF0ZSkpIHtcbiAgICAgIHJlc29sdmUodHJ1ZSlcbiAgICB9IGVsc2Uge1xuICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcigncmVhZHlzdGF0ZWNoYW5nZScsICgpID0+IHtcbiAgICAgICAgaWYgKGNvbmRpdGlvbi5pbmNsdWRlcyhkb2N1bWVudC5yZWFkeVN0YXRlKSkge1xuICAgICAgICAgIHJlc29sdmUodHJ1ZSlcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9XG4gIH0pXG59XG5cbmNvbnN0IHNhZmVET00gPSB7XG4gIGFwcGVuZChwYXJlbnQ6IEhUTUxFbGVtZW50LCBjaGlsZDogSFRNTEVsZW1lbnQpIHtcbiAgICBpZiAoIUFycmF5LmZyb20ocGFyZW50LmNoaWxkcmVuKS5maW5kKGUgPT4gZSA9PT0gY2hpbGQpKSB7XG4gICAgICByZXR1cm4gcGFyZW50LmFwcGVuZENoaWxkKGNoaWxkKVxuICAgIH1cbiAgfSxcbiAgcmVtb3ZlKHBhcmVudDogSFRNTEVsZW1lbnQsIGNoaWxkOiBIVE1MRWxlbWVudCkge1xuICAgIGlmIChBcnJheS5mcm9tKHBhcmVudC5jaGlsZHJlbikuZmluZChlID0+IGUgPT09IGNoaWxkKSkge1xuICAgICAgcmV0dXJuIHBhcmVudC5yZW1vdmVDaGlsZChjaGlsZClcbiAgICB9XG4gIH0sXG59XG5cbi8qKlxuICogaHR0cHM6Ly90b2JpYXNhaGxpbi5jb20vc3BpbmtpdFxuICogaHR0cHM6Ly9jb25ub3JhdGhlcnRvbi5jb20vbG9hZGVyc1xuICogaHR0cHM6Ly9wcm9qZWN0cy5sdWtlaGFhcy5tZS9jc3MtbG9hZGVyc1xuICogaHR0cHM6Ly9tYXRlamt1c3RlYy5naXRodWIuaW8vU3BpblRoYXRTaGl0XG4gKi9cbmZ1bmN0aW9uIHVzZUxvYWRpbmcoKSB7XG4gIGNvbnN0IGNsYXNzTmFtZSA9IGBsb2FkZXJzLWNzc19fc3F1YXJlLXNwaW5gXG4gIGNvbnN0IHN0eWxlQ29udGVudCA9IGBcbkBrZXlmcmFtZXMgc3F1YXJlLXNwaW4ge1xuICAyNSUgeyB0cmFuc2Zvcm06IHBlcnNwZWN0aXZlKDEwMHB4KSByb3RhdGVYKDE4MGRlZykgcm90YXRlWSgwKTsgfVxuICA1MCUgeyB0cmFuc2Zvcm06IHBlcnNwZWN0aXZlKDEwMHB4KSByb3RhdGVYKDE4MGRlZykgcm90YXRlWSgxODBkZWcpOyB9XG4gIDc1JSB7IHRyYW5zZm9ybTogcGVyc3BlY3RpdmUoMTAwcHgpIHJvdGF0ZVgoMCkgcm90YXRlWSgxODBkZWcpOyB9XG4gIDEwMCUgeyB0cmFuc2Zvcm06IHBlcnNwZWN0aXZlKDEwMHB4KSByb3RhdGVYKDApIHJvdGF0ZVkoMCk7IH1cbn1cbi4ke2NsYXNzTmFtZX0gPiBkaXYge1xuICBhbmltYXRpb24tZmlsbC1tb2RlOiBib3RoO1xuICB3aWR0aDogNTBweDtcbiAgaGVpZ2h0OiA1MHB4O1xuICBiYWNrZ3JvdW5kOiAjZmZmO1xuICBhbmltYXRpb246IHNxdWFyZS1zcGluIDNzIDBzIGN1YmljLWJlemllcigwLjA5LCAwLjU3LCAwLjQ5LCAwLjkpIGluZmluaXRlO1xufVxuLmFwcC1sb2FkaW5nLXdyYXAge1xuICBwb3NpdGlvbjogZml4ZWQ7XG4gIHRvcDogMDtcbiAgbGVmdDogMDtcbiAgd2lkdGg6IDEwMHZ3O1xuICBoZWlnaHQ6IDEwMHZoO1xuICBkaXNwbGF5OiBmbGV4O1xuICBhbGlnbi1pdGVtczogY2VudGVyO1xuICBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjtcbiAgYmFja2dyb3VuZDogIzI4MmMzNDtcbiAgei1pbmRleDogOTtcbn1cbiAgICBgXG4gIGNvbnN0IG9TdHlsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3N0eWxlJylcbiAgY29uc3Qgb0RpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpXG5cbiAgb1N0eWxlLmlkID0gJ2FwcC1sb2FkaW5nLXN0eWxlJ1xuICBvU3R5bGUuaW5uZXJIVE1MID0gc3R5bGVDb250ZW50XG4gIG9EaXYuY2xhc3NOYW1lID0gJ2FwcC1sb2FkaW5nLXdyYXAnXG4gIG9EaXYuaW5uZXJIVE1MID0gYDxkaXYgY2xhc3M9XCIke2NsYXNzTmFtZX1cIj48ZGl2PjwvZGl2PjwvZGl2PmBcblxuICByZXR1cm4ge1xuICAgIGFwcGVuZExvYWRpbmcoKSB7XG4gICAgICBzYWZlRE9NLmFwcGVuZChkb2N1bWVudC5oZWFkLCBvU3R5bGUpXG4gICAgICBzYWZlRE9NLmFwcGVuZChkb2N1bWVudC5ib2R5LCBvRGl2KVxuICAgIH0sXG4gICAgcmVtb3ZlTG9hZGluZygpIHtcbiAgICAgIHNhZmVET00ucmVtb3ZlKGRvY3VtZW50LmhlYWQsIG9TdHlsZSlcbiAgICAgIHNhZmVET00ucmVtb3ZlKGRvY3VtZW50LmJvZHksIG9EaXYpXG4gICAgfSxcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IHsgYXBwZW5kTG9hZGluZywgcmVtb3ZlTG9hZGluZyB9ID0gdXNlTG9hZGluZygpXG5kb21SZWFkeSgpLnRoZW4oYXBwZW5kTG9hZGluZylcblxud2luZG93Lm9ubWVzc2FnZSA9IChldikgPT4ge1xuICBldi5kYXRhLnBheWxvYWQgPT09ICdyZW1vdmVMb2FkaW5nJyAmJiByZW1vdmVMb2FkaW5nKClcbn1cblxuc2V0VGltZW91dChyZW1vdmVMb2FkaW5nLCA0OTk5KSJdLCJuYW1lcyI6WyJjb250ZXh0QnJpZGdlIiwiaXBjUmVu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
