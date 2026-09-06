/**
 * amplify.js
 *
 * Configures AWS Amplify v6 exactly once before the React tree mounts.
 * Import and call `configureAmplify()` at the top of main.jsx.
 *
 * Amplify v6 reference:
 *   https://docs.amplify.aws/react/build-a-backend/auth/set-up-auth/
 */
import { Amplify } from 'aws-amplify';

/**
 * Reads VITE_* env vars and configures Amplify Auth for the existing
 * Cognito User Pool / App Client.  Safe to call multiple times; Amplify
 * internally is idempotent.
 */
export function configureAmplify() {
  const region = import.meta.env.VITE_COGNITO_REGION;
  const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
  const userPoolClientId = import.meta.env.VITE_COGNITO_CLIENT_ID;

  if (!region || !userPoolId || !userPoolClientId) {
    throw new Error(
      'Missing Cognito environment variables. ' +
        'Copy .env.example to .env and fill in VITE_COGNITO_REGION, ' +
        'VITE_COGNITO_USER_POOL_ID, and VITE_COGNITO_CLIENT_ID.'
    );
  }

  Amplify.configure({
    Auth: {
      Cognito: {
        region,
        userPoolId,
        userPoolClientId,
        // EMAIL is the sign-in identifier for this user pool.
        loginWith: { email: true },
      },
    },
  });
}
