// This document intentionally contains no controls, hints, status text or error UI.
const video = document.querySelector("video");
const operator = window.opener;
const token = location.hash.slice(1);
const ready = () => operator?.postMessage({ type: "wavescope-output-ready", token }, location.origin);
const fullscreen = () => {
  void video.play().catch(() => {});
  if (!document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => {});
};
document.addEventListener("dblclick", fullscreen);
document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "f") { event.preventDefault(); fullscreen(); }
});
video.addEventListener("contextmenu", (event) => event.preventDefault());
ready();
const heartbeat = setInterval(() => {
  if (!operator || operator.closed) {
    video.srcObject = null;
    clearInterval(heartbeat);
  }
}, 500);
