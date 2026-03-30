import { e as createComponent, k as renderComponent, r as renderTemplate, h as createAstro, m as maybeRenderHead, g as addAttribute, l as renderScript } from '../../chunks/astro/server_Dto7fIJ9.mjs';
import 'piccolore';
import { $ as $$Layout } from '../../chunks/Layout_tA4sm2tN.mjs';
export { renderers } from '../../renderers.mjs';

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
  return renderTemplate`${renderComponent($$result, "Layout", $$Layout, { "title": "FilaMan - Spool" }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<div style="margin-bottom: 24px;"> <a href="/spools" style="color: var(--accent); text-decoration: none;">&larr; <span data-i18n="spools.backToSpools">Back to Spools</span></a> </div> <div id="spool-content"> <p style="color: var(--text-muted);" data-i18n="common.loading">Loading...</p> </div> <div id="actions-section" class="hidden" style="margin-top: 24px;"> <h2 style="font-weight: 600; margin-bottom: 16px;" data-i18n="spools.quickActions">Quick Actions</h2> <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px;"> <button id="btn-measurement" class="fm-btn fm-btn-primary" style="background: var(--accent);" data-i18n="spools.recordWeight">
Record Weight
</button> <button id="btn-adjustment" class="fm-btn fm-btn-outline" style="border-color: var(--accent-2); color: var(--accent-2);" data-i18n="spools.adjust">
Adjust
</button> <button id="btn-status" class="fm-btn fm-btn-outline" style="border-color: var(--accent-3); color: var(--accent-3);" data-i18n="spools.changeStatus">
Change Status
</button> <button id="btn-move" class="fm-btn fm-btn-outline" data-i18n="spools.move">
Move
</button> <a${addAttribute(`/spools/${id}/print`, "href")} target="_blank" id="btn-print-label" class="fm-btn fm-btn-outline" style="border-color: #10b981; color: #10b981; text-decoration: none; display: flex; align-items: center; justify-content: center;"> <span data-i18n="spools.printLabel">Print Label</span> </a> </div> </div> <div id="modal-container" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-50"> <div class="fm-card" style="padding: 24px; width: 100%; max-width: 420px; margin: 16px;"> <h3 id="modal-title" style="font-weight: 600; margin: 0 0 16px 0;"></h3> <form id="modal-form" style="display: grid; gap: 16px;"> <div id="modal-fields"></div> <div id="modal-error" class="fm-alert-error hidden"></div> <div style="display: flex; gap: 12px;"> <button type="submit" id="modal-submit" class="fm-btn fm-btn-primary" data-i18n="common.submit">
Submit
</button> <button type="button" id="modal-cancel" class="fm-btn fm-btn-outline" data-i18n="common.cancel">
Cancel
</button> </div> </form> </div> </div>  <div id="rfid-modal" class="fm-modal-overlay"> <div class="fm-card" style="width: 100%; max-width: 28rem; margin: 0 1rem; padding: 24px;"> <h3 style="font-size: 1.15rem; font-weight: 600; margin-bottom: 16px;" data-i18n="rfid.writeTag">Write RFID Tag</h3> <div id="rfid-content"> <p style="margin-bottom: 16px;" id="rfid-text"></p> <div id="rfid-device-select-container" class="hidden"> <label for="rfid-device-select" class="fm-label" data-i18n="rfid.selectDevice">Select Device</label> <select id="rfid-device-select" class="fm-select" style="margin-bottom: 16px;"></select> </div> <div id="rfid-warning" class="fm-alert fm-alert-warning hidden" style="margin-bottom: 16px;" data-i18n="rfid.tagAlreadyExistsWarning"></div> </div> <div id="rfid-status" class="fm-alert hidden" style="margin-bottom: 16px;"></div> <div style="display: flex; gap: 12px;"> <button id="rfid-confirm" class="fm-btn fm-btn-primary" data-i18n="common.confirm">Confirm</button> <button id="rfid-cancel" class="fm-btn fm-btn-outline" data-i18n="common.cancel">Cancel</button> </div> </div> </div>  <div id="delete-modal" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-50"> <div class="fm-card" style="padding: 24px; width: 100%; max-width: 400px; margin: 16px;"> <h3 id="delete-modal-title" style="font-weight: 600; margin: 0 0 16px 0;" data-i18n="spools.archiveSpool">Archivieren</h3> <div id="delete-modal-content" style="margin-bottom: 20px;"> <p id="delete-modal-message" style="margin: 0 0 16px 0; color: var(--text-muted);" data-i18n="spools.confirmDelete">Möchten Sie diese Spule wirklich löschen?</p> <label class="fm-checkbox-group" style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer;"> <input type="checkbox" id="delete-permanent-checkbox" style="width: 18px; height: 18px; margin-top: 2px; accent-color: var(--accent);"> <span data-i18n="spools.permanentDeleteLabel">Endgültig löschen statt archivieren</span> </label> <p id="delete-permanent-warning" class="hidden" style="margin: 12px 0 0 0; padding: 12px; background: rgba(239, 68, 68, 0.1); border-radius: 8px; font-size: 0.85rem; color: var(--error-text);" data-i18n="spools.permanentDeleteWarning">
Diese Spule wird dauerhaft aus der Datenbank gelöscht und fließt nicht mehr in Statistiken ein.
</p> </div> <div style="display: flex; gap: 12px;"> <button id="btn-delete-confirm" class="fm-btn fm-btn-danger" data-i18n="spools.archiveSpool">Archivieren</button> <button id="btn-delete-cancel" class="fm-btn fm-btn-outline" data-i18n="common.cancel">Cancel</button> </div> </div> </div> <div id="events-section" class="hidden" style="margin-top: 32px;"> <h2 style="font-weight: 600; margin-bottom: 16px;" data-i18n="spools.eventHistory">Event History</h2> <div class="fm-card" style="padding: 0;"> <table class="fm-table"> <thead> <tr style="background: var(--bg-soft);"> <th data-i18n="spools.eventType">Type</th> <th data-i18n="spools.eventDate">Date</th> <th data-i18n="spools.eventWeight">Weight</th> <th data-i18n="common.note">Note</th> </tr> </thead> <tbody id="events-table"> <tr> <td colspan="4" style="text-align: center; color: var(--text-muted);" data-i18n="common.loading">Loading...</td> </tr> </tbody> </table> </div> </div> ${renderScript($$result2, "/Users/manuel/dev/FilaMan/FilaMan-System-opencode/frontend/src/pages/spools/[id]/index.astro?astro&type=script&index=0&lang.ts")} ` })}`;
}, "/Users/manuel/dev/FilaMan/FilaMan-System-opencode/frontend/src/pages/spools/[id]/index.astro", void 0);

const $$file = "/Users/manuel/dev/FilaMan/FilaMan-System-opencode/frontend/src/pages/spools/[id]/index.astro";
const $$url = "/spools/[id]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  getStaticPaths,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
