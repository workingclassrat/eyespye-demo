/** EYESPYE wordmark: wide-tracked caps, with steel-blue arcs and a pupil turning the S into an eye. */
export function wordmark(extraClass = ""): string {
  return `<span class="wm ${extraClass}" aria-label="EyeSpye"><span>EYE</span><span class="wm-s">S<svg class="wm-arcs"><use href="#wm-arcs" /></svg><i class="wm-pupil"></i></span><span>PYE</span></span>`;
}
