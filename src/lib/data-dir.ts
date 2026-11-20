import path from "node:path";

export const DATA_DIR = path.resolve(process.env.DUMP_DATA_DIR ?? path.join(process.cwd(), "data"));
