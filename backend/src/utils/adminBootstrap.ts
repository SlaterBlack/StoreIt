import bcrypt from 'bcryptjs';
import { stdin, stdout } from 'node:process';
import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { env } from '../config/env';
import { User } from '../models/User';
import { EMAIL_PATTERN, MIN_PASSWORD_LENGTH, normalizeEmail } from './userHelpers';

interface Keypress {
  ctrl?: boolean;
  meta?: boolean;
  name?: string;
}

export async function ensureAdminExists(): Promise<void> {
  const admin = await User.findOne({ where: { role: 'admin' }, attributes: ['id'] });
  if (admin) {
    return;
  }

  if (!stdin.isTTY || !stdout.isTTY) {
    console.warn(
      'No admin account exists. Run `npm run admin:create` from backend in an interactive terminal.',
    );
    return;
  }

  console.log('No admin account exists. Create the initial administrator account.');
  await createAdminFromTerminal();
}

export async function createAdminFromTerminal(): Promise<void> {
  const admin = await User.findOne({ where: { role: 'admin' }, attributes: ['id'] });
  if (admin) {
    console.log('An admin account already exists; no changes made.');
    return;
  }
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('Admin setup requires an interactive terminal.');
  }

  const readline = createInterface({ input: stdin, output: stdout });
  let name: string;
  let email: string;
  try {
    name = (await readline.question('Admin name: ')).trim();
    email = normalizeEmail(await readline.question('Admin email: '));
  } finally {
    readline.close();
  }

  if (!name || name.length > 120) {
    throw new Error('Name must be between 1 and 120 characters.');
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error('Enter a valid email address.');
  }
  if (await User.findOne({ where: { email } })) {
    throw new Error('An account with that email already exists. Choose another address.');
  }

  const password = await promptHidden('Admin password (input hidden): ');
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const confirmation = await promptHidden('Confirm password (input hidden): ');
  if (password !== confirmation) {
    throw new Error('The passwords do not match.');
  }

  const passwordHash = await bcrypt.hash(password, env.bcryptSaltRounds);
  await User.create({ name, email, passwordHash, role: 'admin' });
  console.log(`Created admin account for ${email}.`);
}

function promptHidden(question: string): Promise<string> {
  emitKeypressEvents(stdin);
  const previousRawMode = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  stdout.write(question);

  return new Promise((resolve, reject) => {
    let value = '';

    const cleanup = (): void => {
      stdin.off('keypress', onKeypress);
      stdin.setRawMode(previousRawMode);
      stdout.write('\n');
    };

    const onKeypress = (character: string, key: Keypress): void => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        reject(new Error('Admin setup cancelled.'));
        return;
      }
      if (key.name === 'return') {
        cleanup();
        resolve(value);
        return;
      }
      if (key.name === 'backspace') {
        value = Array.from(value).slice(0, -1).join('');
        return;
      }
      if (character && !key.ctrl && !key.meta) {
        value += character;
      }
    };

    stdin.on('keypress', onKeypress);
  });
}
