/* Shared helpers of the Essensplan card. */
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const localDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export function offsetDay(stamp, n) { const d = new Date(`${stamp}T12:00:00`); d.setDate(d.getDate()+n); return localDate(d); }
export function monday(stamp) { const d = new Date(`${stamp}T12:00:00`); return offsetDay(stamp, -((d.getDay()+6)%7)); }
export const labelDate = stamp => new Date(`${stamp}T12:00:00`).toLocaleDateString('de-DE', {weekday:'long',day:'2-digit',month:'2-digit'});
export const pretty = n => new Intl.NumberFormat('de-DE',{maximumFractionDigits:3}).format(n);

export async function prepareRecipeImage(file, maxMB = 20) {
  if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) {
    throw new Error('Bitte ein JPEG-, PNG-, WebP- oder GIF-Bild auswählen.');
  }
  if (!file.size || file.size > maxMB * 1024 * 1024) throw new Error('Das Bild darf höchstens ' + maxMB + ' MB groß sein.');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  const matches = {
    'image/jpeg': bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    'image/png': bytes[0] === 137 && ascii(1, 8) === 'PNG\r\n\x1a\n',
    'image/webp': ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP',
    'image/gif': ['GIF87a','GIF89a'].includes(ascii(0, 6)),
  };
  if (!matches[file.type]) throw new Error('Dateiinhalt passt nicht zum Bildformat.');
  const source = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve,reject)=>{
      const img = new Image();
      img.onload=()=>resolve(img);
      img.onerror=()=>reject(new Error('Das Bild konnte nicht geöffnet werden. Bitte ein anderes Bild auswählen.'));
      img.src=source;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 50000000) {
      throw new Error('Die Bildauflösung ist zu groß. Bitte ein kleineres Bild auswählen.');
    }
    const scale = Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const context=canvas.getContext('2d');
    if (!context) throw new Error('Dieser Browser kann das Bild nicht vorbereiten.');
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0,canvas.width,canvas.height);
    return await new Promise((resolve,reject)=>canvas.toBlob(blob=>{
      if(blob && blob.type==='image/jpeg' && blob.size < 9*1024*1024) resolve(blob);
      else reject(new Error('Das Bild konnte nicht verkleinert werden. Bitte ein anderes Bild auswählen.'));
    },'image/jpeg',0.85));
  } finally { URL.revokeObjectURL(source); }
}
