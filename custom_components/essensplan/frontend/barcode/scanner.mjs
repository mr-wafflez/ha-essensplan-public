const assets='/essensplan_static/barcode';
let library;

function loadReader() {
  if (!library) library=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=assets+'/zxing-browser.min.js?v=0.16.1';
    script.onload=()=>globalThis.ZXingBrowser ? resolve(globalThis.ZXingBrowser) : reject(new Error('Barcode-Scanner konnte nicht geladen werden.'));
    script.onerror=()=>reject(new Error('Barcode-Scanner konnte nicht geladen werden.'));
    document.head.append(script);
  }).catch(error=>{library=undefined;throw error;});
  return library;
}

export async function scanPhoto(file) {
  if (!file.type.startsWith('image/') || !file.size || file.size>20*1024*1024) {
    throw new Error('Wähle ein Barcode-Foto bis 20 MB.');
  }
  const {BrowserMultiFormatOneDReader}=await loadReader();
  const url=URL.createObjectURL(file);
  try {
    const result=await new BrowserMultiFormatOneDReader().decodeFromImageUrl(url);
    return result.getText();
  } catch {
    throw new Error('Kein Barcode erkannt. Fotografiere ihn möglichst gerade und gut beleuchtet.');
  } finally { URL.revokeObjectURL(url); }
}

export async function scanCamera(stream, video, signal, found) {
  const {BrowserMultiFormatOneDReader}=await loadReader();
  if (signal.aborted) return;
  let controls;
  const stop=()=>{
    controls?.stop();
    video.srcObject=null;
  };
  if (signal.aborted) {stop();return;}
  signal.addEventListener('abort',stop,{once:true});
  try {
    controls=await new BrowserMultiFormatOneDReader().decodeFromStream(stream,video,result=>{
      if (!signal.aborted && result) found(result.getText());
    });
    if (signal.aborted) stop();
  } catch(error) {
    stop();
    throw error;
  }
}
