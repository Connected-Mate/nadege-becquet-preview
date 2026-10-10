(() => {
  const removal = document.body.dataset.removalDate;
  if (removal && new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()) >= removal) {
    const main = document.createElement('main'); main.className = 'expired';
    const h = document.createElement('h1'); h.textContent = 'Cette démonstration est terminée.';
    const p = document.createElement('p'); p.textContent = 'La période de présentation a pris fin. Cette adresse ne constitue pas le site officiel de Nadège Becquet.';
    main.append(h,p); document.body.replaceChildren(main); return;
  }
  const toggle=document.querySelector('.menu-toggle'),nav=document.querySelector('#main-nav');
  toggle?.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')==='true';toggle.setAttribute('aria-expanded',String(!open));nav.classList.toggle('is-open',!open)});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&nav?.classList.contains('is-open')){nav.classList.remove('is-open');toggle.setAttribute('aria-expanded','false');toggle.focus()}});
  const dialog=document.querySelector('#demo-dialog');let lastFocus;
  const show=()=>{lastFocus=document.activeElement;dialog.showModal();document.body.classList.add('modal-open')};
  const close=()=>{dialog.close();};
  dialog?.addEventListener('close',()=>{document.body.classList.remove('modal-open');try{sessionStorage.setItem('nadege-demo-seen','1')}catch{}if(lastFocus instanceof HTMLElement)lastFocus.focus()});
  document.querySelectorAll('[data-demo-open]').forEach(b=>b.addEventListener('click',show));
  document.querySelectorAll('[data-demo-close]').forEach(b=>b.addEventListener('click',close));
  let seen=false;try{seen=sessionStorage.getItem('nadege-demo-seen')==='1'}catch{}
  if(dialog&&!seen)show();
  const mapButton=document.querySelector('#load-map');
  mapButton?.addEventListener('click',()=>{const slot=document.querySelector('#map-slot');const frame=document.createElement('iframe');frame.title='Carte Google Maps : 160 rue Grande, Fontainebleau';frame.src=`https://maps.google.com/maps?q=${encodeURIComponent(mapButton.dataset.mapQuery)}&output=embed`;frame.loading='lazy';frame.referrerPolicy='no-referrer-when-downgrade';slot.replaceChildren(frame);});
})();
