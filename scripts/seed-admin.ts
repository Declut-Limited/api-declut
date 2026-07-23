// One-time bootstrap for the very first admin account. Admin is now a
// wholly separate Mongoose collection from User (see src/admin-auth) with
// its own JWT secrets — there's no "promote a user" path anymore, and even
// if there were, the very first admin still couldn't come from an
// already-logged-in admin, since none exists yet. This script is the
// one-time manual DB step that breaks that chicken-and-egg problem. Run it
// once per environment; every admin after the first is created by an
// already-authenticated admin via POST /admin/auth/sub-admins.
//
// Usage: npm run seed:admin -- <email> <password> [name]
import 'dotenv/config';
import * as mongoose from 'mongoose';
import * as bcrypt from 'bcrypt';
import { AdminSchema } from '../src/admin-auth/schemas/admin.schema';

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
  const AdminModel = mongoose.model('Admin', AdminSchema);

  const normalizedEmail = email.toLowerCase();
  const existing = await AdminModel.findOne({ email: normalizedEmail });
  if (existing) {
    console.error(
      `An admin with email ${normalizedEmail} already exists. ` +
        'This script only bootstraps the FIRST admin — use POST /admin/auth/sub-admins (as an existing admin) instead.',
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  const admin = await AdminModel.create({
    email: normalizedEmail,
    name: name || 'Admin',
    passwordHash,
    // No createdBy — this is the root admin, nobody created it.
  });

  console.log(`Admin created: ${admin.get('email')} (${admin._id.toString()})`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
