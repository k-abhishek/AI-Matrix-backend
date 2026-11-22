import React from "react";
import { AuthenticateWithRedirectCallback } from "@clerk/react";
import LoadingSpinner from "../components/ui/LoadingSpinner";

export const SSOCallbackPage: React.FC = () => {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <LoadingSpinner />
        <p className="text-sm text-muted-foreground animate-pulse">
          Completing authentication...
        </p>
        <AuthenticateWithRedirectCallback />
      </div>
    </div>
  );
};

export default SSOCallbackPage;
