import { openDatabase } from '../lib/database.mjs';
import { authSchema,createUser } from '../lib/auth.mjs';
const [email,business]=process.argv.slice(2);const password=process.env.FOODTRUCK_ADMIN_PASSWORD;
if(!email||!business||!password)throw new Error('Usage: FOODTRUCK_ADMIN_PASSWORD environment variable + node scripts/create-user.mjs email business-slug');
const db=openDatabase();try{authSchema(db);const record=db.prepare('SELECT id FROM businesses WHERE slug=?').get(business);if(!record)throw new Error('Unknown business slug.');createUser(db,email,password,record.id);console.log('Owner account created.');}finally{db.close();}
