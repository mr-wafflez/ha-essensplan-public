/* Styles of the Essensplan card; colors follow the Home Assistant theme. */
export const CARD_STYLES = `
      :host{display:block;color:var(--primary-text-color);font-family:var(--paper-font-body1_-_font-family, sans-serif)}
      *{box-sizing:border-box}ha-card{padding:18px;overflow:hidden}h2{font-size:22px;margin:4px 0 12px}h3{margin:12px 0 8px;font-size:18px}p{line-height:1.5}small,.muted{color:var(--secondary-text-color)}
      button,select,input,textarea{font:inherit;color:var(--primary-text-color);border:1px solid var(--divider-color,#8885);border-radius:10px;background:var(--card-background-color,#fff);padding:10px;min-height:44px}
      button{cursor:pointer}button:hover{border-color:var(--primary-color)}button:focus-visible,input:focus,textarea:focus,select:focus{outline:2px solid var(--primary-color);outline-offset:2px}
      .primary{background:var(--primary-color);color:var(--text-primary-color,#fff);border-color:transparent}.danger{color:var(--error-color,#c33)}
      .row,.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .row{justify-content:space-between}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:12px}
      .recipe{border:1px solid var(--divider-color,#8883);border-radius:16px;padding:12px}.recipe img,.hero{width:100%;height:150px;object-fit:cover;border-radius:12px}.emoji{font-size:38px;line-height:1.4}
      .tile{width:100%;text-align:left;touch-action:pan-y;padding:18px;border-radius:16px;background:var(--secondary-background-color,#8881)}.tile strong{display:block;font-size:24px;margin:8px 0}.tile small{display:block}
      .meals{display:grid;gap:10px}.tile .cta{display:block;margin-top:10px;font-weight:650;color:var(--primary-color)}
      .day{padding:14px 0;border-bottom:1px solid var(--divider-color,#8883)}.day.today{border-left:3px solid var(--primary-color);padding-left:10px}
      .day-head{display:flex;align-items:center;gap:8px}.badge{font-size:12px;padding:2px 10px;border-radius:999px;background:var(--primary-color);color:var(--text-primary-color,#fff)}
      .slot{display:flex;align-items:stretch;gap:8px;margin:8px 0 0}
      .slot button.slot-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;text-align:left;min-height:58px;padding:12px 16px;border-radius:18px}
      .slot-main strong{font-size:17px;overflow-wrap:anywhere}.slot-main small{overflow-wrap:anywhere}
      .slot.empty button.slot-main{border-style:dashed;color:var(--secondary-text-color)}.slot.empty .slot-main strong{font-weight:500}
      .slot button.slot-check{flex:0 0 56px;width:56px;padding:0;font-size:24px;border-radius:18px}
      .slot button.slot-check[aria-pressed=true]{background:var(--success-color,#2e7d32);border-color:transparent;color:#fff}
      .slot.cooked .slot-main strong{color:var(--secondary-text-color)}
      .back-row{margin-bottom:12px}
      label{display:block;margin:12px 0 5px}input:not([type=checkbox]),textarea{width:100%}textarea{min-height:115px;resize:vertical}li{margin-bottom:12px;line-height:1.5}#error{color:var(--error-color,#c33);white-space:pre-wrap}#error:empty{display:none}
      .check{display:flex;align-items:center;gap:12px;margin:0;padding:10px 0;border-bottom:1px solid var(--divider-color,#8883)}.check input{width:24px;height:24px}.check.done span{text-decoration:line-through;color:var(--secondary-text-color)}
            .recipe-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr));gap:16px;margin-top:14px}
      .recipe-card{min-width:0;border-radius:18px;overflow:hidden;background:var(--card-background-color,#fff);box-shadow:0 3px 14px #0002;border:1px solid var(--divider-color,#8884)}
      .recipe-media{position:relative;aspect-ratio:4/3;background:#e5ab75;overflow:hidden}.recipe-media img{width:100%;height:100%;object-fit:cover;display:block}
      .recipe-info{padding:12px 14px;overflow-wrap:anywhere}.recipe-info h3{margin:0 0 5px}.recipe-info .actions{margin-top:10px}
      .bubbles{position:absolute;right:12px;bottom:12px;display:flex;gap:8px}.bubble{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;padding:0;background:var(--card-background-color,#fff);box-shadow:0 2px 8px #0005}.bubble svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8}
      .barcode-video{width:100%;max-height:240px;object-fit:contain;background:#111}
      dialog.wide{width:min(760px,calc(100% - 24px))}
      button:disabled{opacity:.5;cursor:default}
      .ing-summary{font-weight:600;margin:8px 0}
      .ing-list,.amount-table{display:grid;gap:8px;margin:12px 0}
      .ing-row,.amount-row{border:1px solid var(--divider-color,#8884);border-radius:16px;padding:10px 12px;min-width:0;background:var(--card-background-color,#fff)}
      .ing-row.changed{border-color:var(--primary-color)}
      .ing-head{display:grid;grid-template-columns:minmax(150px,1fr) minmax(0,1.5fr) auto;gap:10px;align-items:center}
      .ing-head .actions{justify-content:flex-end;flex-wrap:nowrap}
      .ing-name,.ing-state{min-width:0;overflow-wrap:anywhere}.ing-name small,.ing-state small{display:block}
      .ing-head .actions button{min-height:40px;padding:6px 14px}
      .ok{color:var(--success-color,#2e7d32);font-weight:600}.warn{color:var(--warning-color,#b26a00);font-weight:600}
      .amount-row{display:grid;grid-template-columns:88px 96px minmax(0,1fr) auto;gap:8px;align-items:center}
      .amount-row input[data-qty]{width:100%;text-align:right}.amount-row select{width:100%}
      .amount-name{min-width:0;overflow-wrap:anywhere}.amount-state{font-size:13px}
      .amount-row > button{min-height:40px;padding:6px 14px}
      .amount-row .ing-panel,.amount-row .amount-reset{grid-column:1 / -1}
      .ing-panel{margin-top:10px;padding-top:10px;border-top:1px dashed var(--divider-color,#8885)}
      .ing-panel fieldset{border:1px solid var(--divider-color,#8884);border-radius:12px;margin:10px 0;min-width:0}
      .choice-list{display:grid;gap:2px;margin:8px 0;max-height:260px;overflow:auto}
      .check-line{display:flex;align-items:center;gap:10px;margin:6px 0}.check-line input{width:22px;height:22px;flex:0 0 auto;min-height:0}
      .choice{padding:6px 8px;border-radius:10px}.choice:has(input:checked){background:var(--secondary-background-color,#8882)}
      .search-line{display:flex;flex-wrap:wrap;gap:8px;align-items:end}.search-line label{flex:1 1 220px;margin:6px 0 0}
      .choice>span{display:flex;flex-direction:column;min-width:0}.choice small{color:var(--secondary-text-color);font-size:12px}
      .choice-heading{margin:8px 8px 2px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--secondary-text-color)}
      .choice-list{max-height:none;overflow:visible}.scan-box{display:grid;gap:8px;margin:8px 0}
      .weight-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0 10px}
      .weight-grid label{margin:8px 0 0;font-size:13px}
      details summary{cursor:pointer;margin:8px 0;font-weight:600}
      button.link{border:0;background:none;padding:0 4px;min-height:0;color:var(--primary-color);text-decoration:underline;box-shadow:none;font-size:inherit}
      .sticky-actions{position:sticky;bottom:-16px;background:var(--card-background-color,#fff);padding:10px 0;border-top:1px solid var(--divider-color,#8883)}
      @media(max-width:560px){.ing-head{grid-template-columns:minmax(0,1fr)}.ing-head .actions{flex-wrap:wrap}
        .amount-row{grid-template-columns:76px 88px minmax(0,1fr)}.amount-row .amount-name{grid-column:1 / -1;grid-row:1}
        .amount-row > button{grid-column:3}}
      .ocr-columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:12px;align-items:start}
      .ocr-columns img{display:block;max-width:100%;max-height:380px;object-fit:contain;border-radius:8px}.ocr-columns textarea{min-height:220px}
      .picker-list{display:grid;gap:8px;margin:12px 0}.picker-list button{text-align:left}
      dialog{box-sizing:border-box;width:min(560px,calc(100% - 24px));max-height:calc(100% - 24px);overflow:auto;border:1px solid var(--divider-color,#8885);border-radius:18px;padding:16px;color:var(--primary-text-color,#222);background:var(--card-background-color,#fff)}dialog::backdrop{background:#0008}dialog select{width:100%}.detail-cover{margin-bottom:12px}
      .image-preview{display:block;width:100%;max-height:220px;object-fit:contain;border-radius:12px;margin:10px 0;background:var(--secondary-background-color,#8881)}[hidden]{display:none!important}
      :host{
        --ep-surface:var(--card-background-color,#fff);
        --ep-text:var(--primary-text-color,#202631);
        --ep-accent:var(--primary-color,#507ca0);
        --ep-edge:var(--divider-color,#80808040);
        --ep-glint:#fff3;
        --ep-shadow:0 8px 24px #0002;
        font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      ha-card{
        color:var(--ep-text);border-radius:26px;border:1px solid var(--ep-edge);
        background:var(--ep-surface);
        background-image:url("/essensplan_static/kitchen-background.svg?v=0.17.0"),
          radial-gradient(ellipse at top left,#d9a47524,transparent 68%);
        background-size:min(100%,640px) auto,100% 360px;
        background-position:top right,top left;background-repeat:no-repeat;
        box-shadow:var(--ep-shadow),inset 0 1px 0 var(--ep-glint);
      }
      h2,h3{letter-spacing:-.025em}
      .recipe-card,.tile,dialog{
        border-radius:22px;background:var(--ep-surface);border:1px solid var(--ep-edge);
        box-shadow:0 6px 20px #0002,inset 0 1px 0 var(--ep-glint);
      }
      .recipe-media::after{
        content:"";position:absolute;inset:0;pointer-events:none;
        background:linear-gradient(155deg,#fff2,transparent 38%,transparent 65%,#0003);
      }
      .bubbles{z-index:1}
      button:not(.tile){border-radius:999px}
      button:not(.primary),select,input,textarea{box-shadow:inset 0 1px 0 var(--ep-glint)}
      .bubble{background:var(--ep-surface);color:var(--ep-text);border:1px solid var(--ep-glint);box-shadow:0 3px 12px #0005,inset 0 1px 0 var(--ep-glint)}
      nav{
        display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin:0 0 16px;
        border:1px solid var(--ep-edge);border-radius:22px;padding:5px;
        background:var(--secondary-background-color,var(--ep-surface));
      }
      nav button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-height:54px;padding:6px 4px;
        font-size:13px;border-color:transparent;background:transparent}
      nav button .ico{font-size:20px;line-height:1.1}
      nav button[aria-current=page]{background:var(--ep-accent);color:var(--text-primary-color,#fff);font-weight:650}
      dialog{box-shadow:0 16px 54px #0005,inset 0 1px 0 var(--ep-glint)}
      @supports (color:color-mix(in srgb,white,black)){
        ha-card{
          background-image:url("/essensplan_static/kitchen-background.svg?v=0.17.0"),
            radial-gradient(ellipse at 2% 0%,color-mix(in srgb,#e6ad7d 20%,transparent),transparent 63%),
            radial-gradient(ellipse at 96% 16%,color-mix(in srgb,#9baa7f 18%,transparent),transparent 65%),
            radial-gradient(ellipse at 5% 100%,color-mix(in srgb,var(--ep-accent) 12%,transparent),transparent 66%);
          background-size:min(100%,640px) auto,100% 420px,100% 420px,100% 360px;
          background-position:top right,top left,top right,bottom left;
        }
        .recipe-card,.tile,.slot-main{background:color-mix(in srgb,var(--ep-surface) 86%,transparent)}
        .bubble{background:color-mix(in srgb,var(--ep-surface) 91%,transparent)}
        dialog{background:color-mix(in srgb,var(--ep-surface) 97%,transparent)}
      }
      @supports (backdrop-filter:blur(8px)){
        .bubble{backdrop-filter:blur(8px)}
      }
      .ingredients-field{margin:18px 0 0;padding:0;border:0;min-width:0;container-type:inline-size}
      .ingredients-field legend{font-weight:650;padding:0}
      .ingredient-row{
        display:grid;grid-template-columns:minmax(0,2fr) minmax(76px,.65fr) minmax(100px,1fr) 44px;
        align-items:end;gap:8px;margin:8px 0;padding:10px;border:1px solid var(--ep-edge);border-radius:14px;
        background:var(--ep-surface)
      }
      .ingredient-row label{min-width:0;margin:0;font-size:13px}
      .ingredient-row input,.ingredient-row select{display:block;width:100%;min-width:0;margin-top:4px;font-size:16px}
      .ingredient-row button{width:44px;padding:0;font-size:20px;line-height:1}
      @container (max-width:430px){
        .ingredient-row{grid-template-columns:minmax(0,1fr) minmax(0,1.35fr) 44px}
        .ingredient-row .ingredient-name{grid-column:1 / -1}
      }
      @media(max-width:470px){
        .ingredient-row{grid-template-columns:minmax(0,1fr) minmax(0,1.35fr) 44px}
        .ingredient-row .ingredient-name{grid-column:1 / -1}
      }
      @media (prefers-reduced-transparency:reduce), (forced-colors:active){
        ha-card,.recipe-card,.tile,.slot-main,.bubble,dialog{background:var(--ep-surface);backdrop-filter:none}
      }
      .hint{font-size:13px;line-height:1.5}.spacer{margin-top:12px}@media(max-width:450px){ha-card{padding:12px}nav{gap:2px}nav button{font-size:12px}.slot button.slot-main{padding:10px 12px}.slot button.slot-check{flex-basis:50px;width:50px}}
    `;
