// One import point for every Declut email template:
//   const { welcomeEmail } = require('../../emails');
//   const { subject, html } = welcomeEmail({ name: user.name });
module.exports = {
  ...require('./mobile/welcomeEmail'),
  ...require('./mobile/otpEmail'),
  ...require('./mobile/passwordChangedEmail'),
  ...require('./mobile/paymentSuccessfulEmail'),
  ...require('./mobile/paymentInEscrowEmail'),
  ...require('./mobile/itemSoldEmail'),
  ...require('./mobile/waitlistInviteEmail'),
  ...require('./mobile/adminMessageEmail'),
  ...require('./mobile/notificationEmail'),
  ...require('./web/adminPasswordResetEmail'),
  ...require('./web/subAdminInviteEmail'),
  ...require('./web/contactMessageEmail'),
};
