/**
 * Logical size of the board (not screen pixels: the <Stage> is scaled to the visible
 * area with `fitViewport`). Lowering it does not change the contract or the layout:
 * typography is fixed in px (ROLE_STYLE), so a smaller canvas makes the same text
 * fill a larger share of the board. 16:9 is mandatory. 1920x1080 looked empty;
 * 1440x810 is the current size; 1280x720 fills more but the columns get narrow
 * (~20 characters per line in a group slot) and bottom overflow becomes likelier.
 */
export const CANVAS_W = 1440
export const CANVAS_H = 810
