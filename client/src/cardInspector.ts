/** Detalhe fixo em pixels de tela para leitura durante o duelo. */
export function openCardInspector(name: string, rules: string, cost: number, art: string) {
  const dialog = document.createElement('dialog');
  dialog.className = 'card-inspector';
  dialog.setAttribute('aria-label', name);
  const image = new Image();
  image.src = art;
  image.alt = '';
  const title = document.createElement('h2');
  title.textContent = name;
  const ki = document.createElement('span');
  ki.textContent = cost + ' Ki';
  const text = document.createElement('p');
  text.textContent = rules;
  const close = document.createElement('button');
  close.textContent = 'Voltar à arena';
  close.onclick = () => dialog.close();
  dialog.append(image, ki, title, text, close);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  (document.fullscreenElement ?? document.body).append(dialog);
  dialog.showModal();
  return dialog;
}
