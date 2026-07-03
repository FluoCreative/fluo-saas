const { createUser } = require('./database');

const username = process.argv[2];
const password = process.argv[3];

if (!username || !password) {
    console.log('Uso: node create_user.js <username> <password>');
    process.exit(1);
}

createUser(username, password)
    .then(id => {
        console.log(`Usuário criado com sucesso. ID: ${id}`);
        process.exit(0);
    })
    .catch(err => {
        console.error('Erro ao criar usuário:', err);
        process.exit(1);
    });
