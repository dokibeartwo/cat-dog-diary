// Keep native input values and validity; replace only their visual pickers.
(() => {
  const rules = window.ControlRules;
  const panel = document.createElement('div');
  panel.id = 'theme-value-picker'; panel.className = 'themed-picker'; panel.hidden = true;
  panel.setAttribute('popover','manual');
  panel.setAttribute('role','dialog');
  let owner = null, kind = null, cursor = null, draft = '', originValue = '';
  const node = (tag, cls, text) => { const el=document.createElement(tag); if(cls) el.className=cls; if(text) el.textContent=text; return el; };
  const button = (text, cls, fn) => { const el=node('button',cls,text); el.type='button'; el.addEventListener('click',fn); return el; };
  function close(restoreFocus = false) {
    const previous=owner; if (!previous) return;
    previous.setAttribute('aria-expanded','false'); owner=null;
    if(panel.matches(':popover-open'))panel.hidePopover();panel.hidden=true;
    if(restoreFocus && previous.isConnected) previous.focus({preventScroll:true});
  }
  function commit(value) {
    const input=owner;
    if (!input || input.disabled || !input.isConnected) {close();return;}
    if(value === '' ? input.required : kind==='date' ? !rules.allowedDate(value,input.min,input.max) : !rules.allowedTime(value,input.min,input.max)) return;
    close(true);
    if(input.value!==value) {input.value=value; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true}));}
  }
  function place() {
    if(!owner) return;
    const bounds={left:8,top:8,right:innerWidth-8,bottom:innerHeight-8};
    const rect=owner.getBoundingClientRect();
    panel.style.width=`${Math.max(240,Math.min(340,bounds.right-bounds.left-16))}px`;
    panel.style.maxHeight=`${Math.max(160,bounds.bottom-bounds.top-16)}px`;
    panel.style.left='0px';panel.style.top='0px';panel.hidden=false;
    if(!panel.matches(':popover-open'))panel.showPopover();
    const origin=panel.getBoundingClientRect();
    const top=rect.bottom+panel.offsetHeight+8<=bounds.bottom ? rect.bottom+6 : rect.top-panel.offsetHeight-6;
    panel.style.left=`${Math.max(bounds.left+4, Math.min(rect.left,bounds.right-panel.offsetWidth-4))-origin.left}px`;
    panel.style.top=`${Math.max(bounds.top+4, Math.min(top,bounds.bottom-panel.offsetHeight-4))-origin.top}px`;
  }
  function datePanel() {
    panel.replaceChildren();panel.setAttribute('aria-label','选择日期');
    const heading=node('div','picker-heading');
    const move=(delta)=>{ const next=new Date(cursor);next.setDate(1);next.setMonth(next.getMonth()+delta);if(next.getFullYear()<1||next.getFullYear()>9999)return;cursor=next;datePanel();place(); };
    const prev=button('‹','picker-nav',()=>move(-1));prev.setAttribute('aria-label','上个月');
    const next=button('›','picker-nav',()=>move(1));next.setAttribute('aria-label','下个月');
    heading.append(prev);
    const year=node('input','picker-year');year.type='number';year.min='1';year.max='9999';year.value=cursor.getFullYear();year.setAttribute('aria-label','年份');
    const month=node('input','picker-month');month.type='number';month.min='1';month.max='12';month.value=cursor.getMonth()+1;month.setAttribute('aria-label','月份');
    const changeMonth=()=>{if(!year.checkValidity()||!month.checkValidity()||!year.value||!month.value)return;cursor.setDate(1);cursor.setFullYear(Number(year.value),Number(month.value)-1,1);datePanel();place();};
    year.addEventListener('change',changeMonth);month.addEventListener('change',changeMonth);
    heading.append(year,node('span','','年'),month,node('span','','月'),next);panel.append(heading);
    const weekdays=node('div','calendar-weekdays');for(const day of ['一','二','三','四','五','六','日'])weekdays.append(node('span','',day));panel.append(weekdays);
    const grid=node('div','calendar-days');grid.setAttribute('role','grid');
    for(const day of rules.calendarDays(cursor.getFullYear(),cursor.getMonth()+1,originValue,owner.min,owner.max)) {
      const el=button(String(day.day),'calendar-day',()=>commit(day.value));el.dataset.date=day.value;
      el.disabled=day.disabled;el.classList.toggle('is-outside',day.outside);el.classList.toggle('is-selected',day.selected);
      el.classList.toggle('is-today',day.value===rules.dateValue());el.setAttribute('aria-label',day.value);el.setAttribute('aria-selected',String(day.selected));
      el.setAttribute('role','gridcell');grid.append(el);
    }
    grid.addEventListener('keydown',(event)=>{
      if(!event.target.dataset.date)return;
      const directions={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
      if(!(event.key in directions))return; event.preventDefault();
      const date=rules.parseDate(event.target.dataset.date);date.setDate(date.getDate()+directions[event.key]);
      const value=rules.dateValue(date);if(!rules.allowedDate(value,owner.min,owner.max))return;
      if(date.getMonth()!==cursor.getMonth()||date.getFullYear()!==cursor.getFullYear()){cursor=date;datePanel();place();}
      panel.querySelector(`[data-date="${value}"]`)?.focus();
    });
    panel.append(grid);
    const footer=node('div','picker-footer');const today=button('今天','picker-link',()=>commit(rules.dateValue()));today.disabled=!rules.allowedDate(rules.dateValue(),owner.min,owner.max);
    footer.append(today);if(!owner.required)footer.append(button('清除','picker-link',()=>commit('')));
    footer.append(button('取消','picker-link',()=>close(true)));panel.append(footer);
  }
  function timePanel() {
    panel.replaceChildren();panel.setAttribute('aria-label','选择时间');
    panel.append(node('strong','picker-title','选择时间'));
    const direct=node('input','picker-time-value');direct.type='text';direct.inputMode='numeric';direct.value=draft;direct.maxLength=5;direct.setAttribute('aria-label','时间，24小时制');
    panel.append(direct);
    const columns=node('div','time-columns');
    const parsed=rules.parseTime(draft) ?? 0;
    for(const [label,count,current,part] of [['小时',24,Math.floor(parsed/60),'hour'],['分钟',60,parsed%60,'minute']]) {
      const col=node('div','time-column');col.append(node('span','',label));
      const list=node('div','time-options');list.setAttribute('role','listbox');list.setAttribute('aria-label',label);
      for(let number=0;number<count;number++) {
        const el=button(rules.pad(number),'time-option',()=>{
          const currentValue=rules.parseTime(draft)??0;
          draft=part==='hour'?`${rules.pad(number)}:${rules.pad(currentValue%60)}`:`${rules.pad(Math.floor(currentValue/60))}:${rules.pad(number)}`;
          timePanel();place();panel.querySelector(`[data-${part}="${number}"]`)?.focus({preventScroll:true});
        });
        el.dataset[part]=String(number);el.setAttribute('role','option');el.setAttribute('aria-selected',String(number===current));
        el.tabIndex=number===current?0:-1;
        el.classList.toggle('is-selected',number===current);list.append(el);
      }
      list.addEventListener('keydown',event=>{
        const element=event.target.closest('.time-option');if(!element)return;
        let value=Number(element.dataset[part]);
        if(event.key==='ArrowDown')value=Math.min(count-1,value+1);
        else if(event.key==='ArrowUp')value=Math.max(0,value-1);
        else if(event.key==='Home')value=0;
        else if(event.key==='End')value=count-1;
        else return;
        event.preventDefault();list.querySelector(`[data-${part}="${value}"]`)?.click();
      });
      col.append(list);columns.append(col);
      requestAnimationFrame(()=> { if(owner&&kind==='time'&&list.isConnected) list.scrollTop=Math.max(0,current*40-80); });
    }
    panel.append(columns);
    const error=node('p','picker-error');error.setAttribute('role','alert');panel.append(error);
    const footer=node('div','picker-footer');footer.append(button('现在','picker-link',()=>{const now=new Date();draft=`${rules.pad(now.getHours())}:${rules.pad(now.getMinutes())}`;timePanel();place();}));
    footer.append(button('取消','picker-link',()=>close(true)));
    const confirm=()=>{
      draft=direct.value;
      if(!rules.allowedTime(draft,owner?.min,owner?.max)){error.textContent='请输入范围内的时间（00:00–23:59）';place();return;}
      const value=rules.parseTime(draft);commit(`${rules.pad(Math.floor(value/60))}:${rules.pad(value%60)}`);
    };
    footer.append(button('确定','picker-confirm',confirm));panel.append(footer);
    direct.addEventListener('input',()=>{draft=direct.value;error.textContent='';});
    direct.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();confirm();}});
  }
  function open(input) {
    if(!input || input.disabled || input.readOnly)return;
    document.dispatchEvent(new CustomEvent('theme-popup-opening',{detail:panel}));
    owner=input;kind=input.type;originValue=input.value;input.setAttribute('aria-expanded','true');input.setAttribute('aria-controls',panel.id);
    (input.closest('dialog')||document.body).append(panel);
    if(kind==='date'){cursor=rules.parseDate(input.value)||rules.parseDate(input.min)||new Date();datePanel();}
    else {const now=new Date();draft=input.value||`${rules.pad(now.getHours())}:${rules.pad(now.getMinutes())}`;timePanel();}
    place();(kind==='time'?panel.querySelector('.picker-time-value'):panel.querySelector('.calendar-day.is-selected:not(:disabled)')||panel.querySelector('.calendar-day:not(:disabled)'))?.focus({preventScroll:true});
  }
  function decorate() {
    for(const input of document.querySelectorAll('input[type=date],input[type=time],input[type=number]')) {
      if(input.closest('.themed-picker')||input.dataset.themedControl)continue;
      input.dataset.themedControl='true';
      const wrap=node('span',input.type==='number'?'theme-number':'theme-temporal');input.before(wrap);wrap.append(input);
      if(input.type==='number') {
        const step=(direction)=>{if(input.disabled||input.readOnly)return;const next=rules.stepValue(input.value,direction,input.min,input.max,input.step);if(next!==input.value){input.value=next;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}};
        const minus=button('−','number-step',()=>step(-1)),plus=button('+','number-step',()=>step(1));
        minus.setAttribute('aria-label','减少');plus.setAttribute('aria-label','增加');wrap.prepend(minus);wrap.append(plus);
        const sync=()=>{minus.disabled=input.disabled||input.readOnly;plus.disabled=input.disabled||input.readOnly;wrap.classList.toggle('is-disabled',input.disabled);};
        new MutationObserver(sync).observe(input,{attributes:true,attributeFilter:['disabled','readonly']});sync();
      } else {
        const trigger=button('', 'temporal-trigger',()=>open(input));trigger.setAttribute('aria-label',input.type==='date'?'选择日期':'选择时间');
        trigger.innerHTML=input.type==='date'?'<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="15" rx="3"/><path d="M4 11h16M8 3v6M16 3v6"/></svg>':'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></svg>';
        wrap.append(trigger);
        const sync=()=>{trigger.disabled=input.disabled||input.readOnly;wrap.classList.toggle('is-disabled',input.disabled);};new MutationObserver(sync).observe(input,{attributes:true,attributeFilter:['disabled','readonly']});sync();
      }
    }
  }
  function updateContrast() {
    const color=getComputedStyle(document.documentElement).getPropertyValue('--violet').trim().replace('#','');
    if(!/^[0-9a-f]{6}$/i.test(color))return;
    const c=[0,2,4].map(i=>parseInt(color.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    const light=c[0]*.2126+c[1]*.7152+c[2]*.0722;
    document.documentElement.style.setProperty('--control-on-accent',1.05/(light+.05)>=4.5?'#ffffff':'#201b27');
  }
  new MutationObserver(updateContrast).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme-id','data-preview-family']});updateContrast();
  document.addEventListener('theme-popup-opening',event=>{if(event.detail!==panel)close();});
  document.addEventListener('mousedown',event=>{
    if(panel.contains(event.target))return;
    if(owner)close();
    const input=event.target.closest?.('input[data-themed-control]');
    if(input&&['date','time'].includes(input.type)&&!input.disabled){event.preventDefault();open(input);}
  },true);
  document.addEventListener('keydown',event=>{
    if(owner&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close(true);return;}
    const input=event.target.closest?.('input[data-themed-control]');
    if(!owner&&input&&['date','time'].includes(input.type)&&['Enter',' '].includes(event.key)){event.preventDefault();open(input);}
  },true);
  document.addEventListener('scroll',event=>{if(owner&&!panel.contains(event.target))close();},true);
  window.addEventListener('resize',()=>close());window.addEventListener('blur',()=>close());
  new MutationObserver(()=>{decorate();if(owner&&(!owner.isConnected||owner.disabled||!owner.getClientRects().length))close();})
    .observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','open','hidden']});
  window.ThemedControls={open,close,decorate};decorate();
})();
