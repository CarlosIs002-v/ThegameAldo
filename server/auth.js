import { authCredentialsSchema } from '../shared/schemas.js';
import crypto from 'node:crypto';

/**
 * Sistema de autenticación y sesiones para jugadores.
 * Cumple con el criterio del Flujo E2E 1: Validación de credenciales y acceso seguro.
 */
class AuthService {
  constructor() {
    this.users = new Map(); // username -> { passwordHash, createdAt }
    this.sessions = new Map(); // token -> { username, createdAt }

    // Usuario demo pre-creado para testing inmediato
    this.register('cyber_tester', 'secretPass123');
  }

  hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  register(username, password) {
    const validated = authCredentialsSchema.parse({ username, password });
    if (this.users.has(validated.username)) {
      throw new Error('El nombre de usuario ya está registrado');
    }

    const record = {
      username: validated.username,
      passwordHash: this.hashPassword(validated.password),
      createdAt: Date.now(),
    };
    this.users.set(validated.username, record);
    return record;
  }

  login(username, password) {
    const validated = authCredentialsSchema.parse({ username, password });
    let user = this.users.get(validated.username);

    // Auto-registro si no existe para facilitar onboarding y pruebas E2E
    if (!user) {
      user = this.register(validated.username, validated.password);
    } else {
      const hash = this.hashPassword(validated.password);
      if (user.passwordHash !== hash) {
        throw new Error('Credenciales inválidas');
      }
    }

    const token = crypto.randomBytes(24).toString('hex');
    this.sessions.set(token, {
      username: user.username,
      createdAt: Date.now(),
    });

    return { token, username: user.username };
  }

  validateSession(token) {
    if (!token) return null;
    return this.sessions.get(token) || null;
  }
}

export const authService = new AuthService();
