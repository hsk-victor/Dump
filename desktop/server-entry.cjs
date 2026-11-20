// Starts the bundled Next.js standalone server and exits with the desktop app:
// if the app is killed without a clean shutdown, its pid stops answering and
// this server goes with it instead of lingering in the background.
const parent = Number(process.env.DUMP_PARENT_PID);
if (parent) {
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      process.exit(0);
    }
  }, 2000).unref();
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("./server.js");
