import { e as createComponent, k as renderComponent, r as renderTemplate, h as createAstro, l as renderScript, m as maybeRenderHead } from '../../chunks/astro/server_Dto7fIJ9.mjs';
import 'piccolore';
import { $ as $$Layout } from '../../chunks/Layout_tA4sm2tN.mjs';
export { renderers } from '../../renderers.mjs';

var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) => __freeze(__defProp(cooked, "raw", { value: __freeze(cooked.slice()) }));
var _a;
const $$Astro = createAstro();
function getStaticPaths() {
  return [
    { params: { id: "detail" } }
  ];
}
const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Index;
  const { id } = Astro2.params;
  return renderTemplate`${renderComponent($$result, "Layout", $$Layout, { "title": "FilaMan - Filament" }, { "default": async ($$result2) => renderTemplate(_a || (_a = __template([" ", '<div style="margin-bottom: 24px;"> <a href="/filaments" style="color: var(--accent); text-decoration: none;">&larr; <span data-i18n="filaments.backToFilaments">Back to Filaments</span></a> </div> <div id="filament-content"> <p style="color: var(--text-muted);" data-i18n="common.loading">Loading...</p> </div> <div id="spools-section" class="hidden" style="margin-top: 32px;"> <h2 style="font-weight: 600; margin-bottom: 16px;" data-i18n="filaments.spools">Spools</h2> <div class="fm-card" style="padding: 0;"> <table class="fm-table"> <thead> <tr style="background: var(--bg-soft);"> <th data-i18n="spools.id">ID</th> <th data-i18n="spools.status">Status</th> <th data-i18n="spools.remaining">Remaining</th> <th data-i18n="spools.location">Location</th> </tr> </thead> <tbody id="spools-table"> <tr> <td colspan="4" style="text-align: center; color: var(--text-muted);" data-i18n="common.loading">Loading...</td> </tr> </tbody> </table> </div> </div> <div id="price-summary" class="hidden" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 32px;"> <div class="fm-card" style="border-left: 4px solid var(--accent);"> <div style="font-size: 0.85rem; color: var(--text-muted);" data-i18n="filaments.totalValueAvailable">Total Value (available)</div> <div id="total-available-price" style="font-size: 1.4rem; font-weight: 700; color: var(--accent);">0.00</div> </div> <div class="fm-card" style="border-left: 4px solid var(--text-muted);"> <div style="font-size: 0.85rem; color: var(--text-muted);" data-i18n="filaments.totalSpentAllTime">Total Spent (all time)</div> <div id="total-spent-price" style="font-size: 1.4rem; font-weight: 700;">0.00</div> </div> </div> <div id="price-history-section" class="hidden" style="margin-top: 32px; margin-bottom: 32px;"> <h2 style="font-weight: 600; margin-bottom: 16px;" data-i18n="filaments.priceHistory">Price History</h2> <div class="fm-card" style="padding: 24px;"> <div style="height: 300px; width: 100%;"> <canvas id="priceChart"></canvas> </div> </div> </div> <script src="/vendor/chart.min.js"><\/script> ', " "])), maybeRenderHead(), renderScript($$result2, "/Users/manuel/dev/FilaMan/FilaMan-System-opencode/frontend/src/pages/filaments/[id]/index.astro?astro&type=script&index=0&lang.ts")) })}`;
}, "/Users/manuel/dev/FilaMan/FilaMan-System-opencode/frontend/src/pages/filaments/[id]/index.astro", void 0);

const $$file = "/Users/manuel/dev/FilaMan/FilaMan-System-opencode/frontend/src/pages/filaments/[id]/index.astro";
const $$url = "/filaments/[id]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  getStaticPaths,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
