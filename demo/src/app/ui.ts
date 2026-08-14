function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

export function hideSplash(): void {
  const el = $('boot-splash');
  if (!el) return;
  el.classList.add('hidden');
  window.setTimeout(() => el.remove(), 280);
}

export function toast(message: string, kind = 'info'): void {
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

export function quickInput(opts: {
  title: string;
  value?: string;
  placeholder?: string;
  hint?: string;
}): Promise<string | null> {
  const { title, value = '', placeholder = '', hint = '' } = opts;
  const dlg = $('quick-input') as HTMLDialogElement | null;
  const titleEl = $('quick-input-title');
  const field = $('quick-input-field') as HTMLInputElement | null;
  const hintEl = $('quick-input-hint');
  if (!dlg || !field) {
    return Promise.resolve(window.prompt(title, value));
  }
  return new Promise((resolve) => {
    if (titleEl) titleEl.textContent = title;
    if (hintEl) hintEl.textContent = hint;
    field.value = value;
    field.placeholder = placeholder;
    const finish = (result: string | null) => {
      dlg.close();
      dlg.removeEventListener('close', onCancel);
      field.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onCancel = () => finish(null);
    const onKey = (e: KeyboardEvent) => {
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

export function quickConfirm(message: string, opts: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  const { ok = 'OK', danger = false } = opts;
  const dlg = $('quick-confirm') as HTMLDialogElement | null;
  const msg = $('quick-confirm-msg');
  const btnOk = $('quick-confirm-ok') as HTMLButtonElement | null;
  const btnCancel = $('quick-confirm-cancel') as HTMLButtonElement | null;
  if (!dlg || !btnOk) {
    return Promise.resolve(window.confirm(message));
  }
  return new Promise((resolve) => {
    if (msg) msg.textContent = message;
    btnOk.textContent = ok;
    btnOk.classList.toggle('danger', !!danger);
    const finish = (result: boolean) => {
      dlg.close();
      btnOk.onclick = null;
      if (btnCancel) btnCancel.onclick = null;
      dlg.removeEventListener('close', onCancel);
      resolve(result);
    };
    const onCancel = () => finish(false);
    btnOk.onclick = () => finish(true);
    if (btnCancel) btnCancel.onclick = () => finish(false);
    dlg.addEventListener('close', onCancel, { once: true });
    dlg.showModal();
    btnOk.focus();
  });
}
