// Filtro de eco: sem fone, o microfone ouve a própria fala da VZ saindo da caixa de som.
// ehEco(ouvido, falado) diz se o que o microfone ouviu parece ser só a voz dela (e não você interrompendo).
const normalizar = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function ehEco(ouvido, falado) {
  const o = normalizar(ouvido);
  if (!o) return true;
  const f = normalizar(falado);
  if (!f) return false; // ela não estava falando nada: é você
  if ((` ${f} `).includes(` ${o} `)) return true; // a frase inteira que o microfone ouviu está no que ela disse
  const palavras = o.split(' ');
  const dela = new Set(f.split(' '));
  const iguais = palavras.filter((p) => dela.has(p)).length;
  return iguais / palavras.length >= 0.7; // quase tudo o que ouviu são palavras dela
}
