import React, { useEffect } from 'react';
import { useAuth } from '@clerk/react';
import apiClient from '../../api/client';

/**
 * Bridges Clerk's dynamic JWT authentication token into the global apiClient.
 * Ensures every outgoing API call automatically includes:
 * Authorization: Bearer <clerk_token>
 */
export const ClerkAuthBridge: React.FC = () => {
  const { getToken } = useAuth();

  useEffect(() => {
    apiClient.setAuthTokenProvider(async () => {
      try {
        return await getToken();
      } catch (err) {
        console.warn('[ClerkAuthBridge] Failed to fetch session token:', err);
        return null;
      }
    });
  }, [getToken]);

  return null;
};

export default ClerkAuthBridge;
