import React from "react";
import { useLocation, Navigate, Link } from "react-router-dom";
import { LoginForm } from "../components/auth/LoginForm";
import { useAuthContext } from "../context/AuthContext";
import LoadingSpinner from "../components/ui/LoadingSpinner";
import { Grip } from "lucide-react";

export const LoginPage: React.FC = () => {
  const { isLoaded, isSignedIn } = useAuthContext();
  const location = useLocation();
  const rawFrom = (location.state as any)?.from?.pathname;
  const from = rawFrom && rawFrom !== "/login" ? rawFrom : "/";

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingSpinner />
      </div>
    );
  }

  // If already authenticated, redirect straight to intended page or home
  if (isSignedIn) {
    return <Navigate to={from} replace />;
  }

  return (
    <div className="relative min-h-screen flex flex-col justify-center items-center p-4 sm:p-6 md:p-10 bg-background text-foreground transition-colors selection:bg-primary/20">
      {/* Top Header Logo */}
      <div className="absolute top-6 left-6 sm:top-8 sm:left-8">
        <Link
          to="/"
          className="flex items-center gap-2 text-foreground font-bold tracking-tight hover:opacity-85 transition-opacity"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-primary shadow-sm">
            <Grip className="h-8 w-8" />
          </div>
          <div className="flex flex-col text-left leading-none min-w-0">
            <span className="font-semibold text-2xl tracking-tight text-foreground truncate">
              Matrix
            </span>
          </div>
        </Link>
      </div>

      {/* Main Container */}
      <div className="w-full max-w-sm md:max-w-3xl my-auto">
        <LoginForm />
      </div>
    </div>
  );
};

export default LoginPage;
