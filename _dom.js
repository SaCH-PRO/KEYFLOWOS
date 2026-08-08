// Minimal DOM shim — enough to run the artifact's render path and catch throws.
function mkEl(tag){
  const e={ tagName:tag, children:[], dataset:{}, style:{}, _html:"", attrs:{},
    className:"", textContent:"",
    setAttribute(k,v){this.attrs[k]=v;}, getAttribute(k){return this.attrs[k];},
    appendChild(c){this.children.push(c); return c;},
    querySelectorAll(){return [];},
    insertAdjacentHTML(pos,h){this._html+=h;},
    addEventListener(){}, onclick:null, onchange:null };
  Object.defineProperty(e,'innerHTML',{get(){return this._html;},set(v){this._html=v;}});
  return e;
}
const store={};
global.document={
  createElement:mkEl,
  createElementNS:(ns,t)=>mkEl(t),
  getElementById(id){ return store[id] || (store[id]=mkEl("div")); }
};
["tabs","s-flow","s-wiring","s-domains","s-today","s-compete",
 "dStats","dTable","dDetail","trigTable","deadList","tw","td"].forEach(i=>store[i]=mkEl("div"));
store["tw"].checked=true; store["td"].checked=true;
global.window=global;
