import { e as createComponent, k as renderComponent, r as renderTemplate, h as createAstro, m as maybeRenderHead, l as renderScript } from '../../chunks/astro/server_Dto7fIJ9.mjs';
import 'piccolore';
import { $ as $$Layout } from '../../chunks/Layout_tA4sm2tN.mjs';
export { renderers } from '../../renderers.mjs';

const $$Astro = createAstro();
function getStaticPaths() {
  return [
    { params: { id: "detail" } }
  ];
}
const $$id = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$id;
  const { id } = Astro2.params;
  return renderTemplate`${renderComponent($$result, "Layout", $$Layout, { "title": "FilaMan - Printer" }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<div style="margin-bottom: 24px;"> <a href="/printers" style="color: var(--accent); text-decoration: none;">&larr; <span data-i18n="printers.backToPrinters">Back to Printers</span></a> </div> <div id="printer-content"> <p style="color: var(--text-muted);" data-i18n="common.loading">Loading...</p> </div> <div id="ams-section" class="hidden" style="margin-top: 32px;"> <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;"> <h2 style="font-size: 1.3rem; font-weight: 600;" data-i18n="printers.amsUnits">AMS Units</h2> <button id="btn-add-ams" class="fm-btn fm-btn-primary" style="font-size: 0.85rem;" data-i18n="printers.addAmsUnit">
Add AMS Unit
</button> </div> <div id="ams-units" style="display: flex; flex-direction: column; gap: 16px;"></div> </div> <div id="modal-container" class="fm-modal-overlay"> <div class="fm-card" style="width: 100%; max-width: 28rem; margin: 0 1rem; padding: 24px;"> <h3 id="modal-title" style="font-size: 1.15rem; font-weight: 600; margin-bottom: 16px;" data-i18n="printers.addAmsUnit">Add AMS Unit</h3> <form id="modal-form" style="display: flex; flex-direction: column; gap: 16px;"> <div> <label for="ams-unit-no" class="fm-label" data-i18n="printers.unitNumber">
Unit Number *
</label> <input type="number" id="ams-unit-no" required min="0" value="0" class="fm-input"> </div> <div> <label for="ams-name" class="fm-label" data-i18n="printers.unitName">
Name
</label> <input type="text" id="ams-name" data-i18n-placeholder="printers.unitNamePlaceholder" placeholder="e.g. Left AMS" class="fm-input"> </div> <div> <label for="ams-slots" class="fm-label" data-i18n="printers.numberOfSlots">
Number of Slots *
</label> <input type="number" id="ams-slots" required min="1" max="8" value="4" class="fm-input"> </div> <div id="modal-error" class="fm-alert-error hidden"></div> <div style="display: flex; gap: 12px;"> <button type="submit" id="modal-submit" class="fm-btn fm-btn-primary" data-i18n="common.add">
Add
</button> <button type="button" id="modal-cancel" class="fm-btn fm-btn-outline" data-i18n="common.cancel">
Cancel
</button> </div> </form> </div> </div> ${renderScript($$result2, "/Users/manuel/dev/FilaMan/FilaMan-System-opencode/frontend/src/pages/printers/[id].astro?astro&type=script&index=0&lang.ts")} ` })}`;
}, "/Users/manuel/dev/FilaMan/FilaMan-System-opencode/frontend/src/pages/printers/[id].astro", void 0);

const $$file = "/Users/manuel/dev/FilaMan/FilaMan-System-opencode/frontend/src/pages/printers/[id].astro";
const $$url = "/printers/[id]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$id,
  file: $$file,
  getStaticPaths,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
