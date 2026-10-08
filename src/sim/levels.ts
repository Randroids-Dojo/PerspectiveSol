import { gallery } from "./gallery";
import type { Level } from "./types";

/** The six chapters. Placeholder until the campaign is authored. */
export const LEVELS: Level[] = [
  gallery("morning"),
  gallery("noon"),
  gallery("afternoon"),
  gallery("dusk"),
  gallery("night"),
  gallery("dawn"),
].map((l, index) => ({ ...l, index }));
