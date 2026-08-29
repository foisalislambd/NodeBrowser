/** VS Code-style quick input, confirm, toast, and boot splash. */

function $(id) {
  return document.getElementById(id);
}

export function hideSplash() {
  const el = $('boot-splash');
  if (!el) return;
  el.classList.add('hidden');
  window.setTimeout(() => el.remove(), 280);
}

export function toast(message, kind = 'info') {
  let host = $('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  const item = document.createElement('div');
  item.className = 'toast toast-' + kind;
  item.textContent = message;
  host.appendChild(item);
  window.setTimeout(() => {
    item.classList.add('out');
    window.setTimeout(() => item.remove(), 220);
  }, 2400);
}

export function quickInput({ title, value = '', placeholder = '', hint = '' }) {
  const dlg = $('quick-input');
  const titleEl = $('quick-input-title');
  const field = $('quick-input-field');
  const hintEl = $('quick-input-hint');
  if (!dlg || !field) {
    return Promise.resolve(window.prompt(title, value));
  }
  return new Promise((resolve) => {
    titleEl.textContent = title;
    hintEl.textContent = hint;
    field.value = value;
    field.placeholder = placeholder;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      dlg.removeEventListener('close', onCancel);
      field.removeEventListener('keydown', onKey);
      if (dlg.open) dlg.close();
      resolve(result);
    };
    const onCancel = () => finish(null);
    const onKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(field.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      }
    };
    dlg.addEventListener('close', onCancel, { once: true });
    field.addEventListener('keydown', onKey);
    dlg.showModal();
    field.focus();
    field.select();
  });
}

export function quickConfirm(message, { ok = 'OK', danger = false } = {}) {
  const dlg = $('quick-confirm');
  const msg = $('quick-confirm-msg');
  const btnOk = $('quick-confirm-ok');
  const btnCancel = $('quick-confirm-cancel');
  if (!dlg || !btnOk) {
    return Promise.resolve(window.confirm(message));
  }
  return new Promise((resolve) => {
    msg.textContent = message;
    btnOk.textContent = ok;
    btnOk.classList.toggle('danger', !!danger);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      btnOk.onclick = null;
      btnCancel.onclick = null;
      dlg.removeEventListener('close', onCancel);
      if (dlg.open) dlg.close();
      resolve(result);
    };
    const onCancel = () => finish(false);
    btnOk.onclick = () => finish(true);
    btnCancel.onclick = () => finish(false);
    dlg.addEventListener('close', onCancel, { once: true });
    dlg.showModal();
    btnOk.focus();
  });
}
