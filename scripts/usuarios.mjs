// Cria os acessos iniciais (ou um novo) com senha provisória; a pessoa troca no primeiro login.
// Uso: npm run usuarios                      (cria Gabriel, Derik e Mateus, se não existirem)
//      npm run usuarios -- joao "João Silva" (cria um acesso novo)
import { criarUsuario } from '../auth.mjs';

const novos = process.argv[2]
  ? [{ usuario: process.argv[2].toLowerCase(), nome: process.argv[3] || process.argv[2], papel: 'dev' }]
  : [
      { usuario: 'gabriel', nome: 'Gabriel', papel: 'dono' },
      { usuario: 'derik', nome: 'Derik', papel: 'dev' },
      { usuario: 'mateus', nome: 'Mateus', papel: 'dev' },
    ];

for (const u of novos) {
  const senha = criarUsuario(u);
  console.log(senha ? `${u.usuario.padEnd(10)} senha provisória: ${senha}` : `${u.usuario.padEnd(10)} já existe (nada mudou)`);
}
console.log('\nNo primeiro acesso, o sistema pede para trocar a senha.');
