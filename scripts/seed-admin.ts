// One-time bootstrap for the very first admin account. CLAUDE.md flags this
// as a real gap: POST /auth/register and POST /auth/google both
// unconditionally set role: 'user', so no HTTP path can ever produce the
// first admin — and PATCH /admin/users/:id/promote requires an admin to
// already be logged in to call it. This script is the one-time manual DB
// step that breaks the chicken-and-egg problem. Run it once per environment;
// every admin after the first can be created via the promote endpoint.
//
// Usage: npm run seed:admin -- <email> <password> [name]
import 'dotenv/config';
import * as mongoose from 'mongoose';
import * as bcrypt from 'bcrypt';
import { AuthProvider, UserRole, UserSchema } from '../src/users/schemas/user.schema';

async function main() {
  const [, , email, password, name] = process.argv;

  if (!email || !password) {
    console.error('Usage: npm run seed:admin -- <email> <password> [name]');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGODB_URI is not set in .env');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  const UserModel = mongoose.model('User', UserSchema);

  const normalizedEmail = email.toLowerCase();
  const existing = await UserModel.findOne({ email: normalizedEmail });
  if (existing) {
    console.error(
      `A user with email ${normalizedEmail} already exists (role: ${existing.get('role')}). ` +
        'This script only bootstraps the FIRST admin — use PATCH /admin/users/:id/promote (as an existing admin) instead.',
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  const admin = await UserModel.create({
    email: normalizedEmail,
    name: name || 'Admin',
    passwordHash,
    authProvider: AuthProvider.EMAIL,
    role: UserRole.ADMIN,
  });

  console.log(`Admin created: ${admin.get('email')} (${admin._id.toString()})`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
