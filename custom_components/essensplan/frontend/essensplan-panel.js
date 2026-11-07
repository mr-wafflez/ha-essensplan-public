/* The same versioned module is shared with existing Lovelace dashboards. */
import './essensplan-card.js?v=0.7.2';

class EssensplanPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode:'open'});
    this.shadowRoot.innerHTML = `<style>
      :host{display:block;height:100%;overflow:auto;color:var(--primary-text-color);background:var(--primary-background-color) url("/essensplan_static/dashboard-background.svg?v=0.7.2") center/cover no-repeat}
      header{display:flex;align-items:center;gap:12px;height:56px;padding:0 12px;border-bottom:1px solid var(--divider-color);background:var(--card-background-color)}
      h1{font-size:20px;font-weight:400;margin:0}main{max-width:1100px;margin:0 auto;padding:16px;box-sizing:border-box}
      @media(max-width:450px){main{padding:8px}}
    </style><header><ha-menu-button></ha-menu-button><h1>Essensplan</h1></header><main></main>`;
    this._menu = this.shadowRoot.querySelector('ha-menu-button');
    this._card = document.createElement('essensplan-card');
    this._card.setConfig({mode:'week'});
    this.shadowRoot.querySelector('main').append(this._card);
  }
  set hass(value) { this._hass=value; this._menu.hass=value; this._card.hass=value; }
  get hass() { return this._hass; }
  set narrow(value) { this._menu.narrow=value; }
}
if (!customElements.get('essensplan-panel')) customElements.define('essensplan-panel',EssensplanPanel);
