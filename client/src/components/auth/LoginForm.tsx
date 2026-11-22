import * as React from "react";
import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useSignIn, useSignUp } from "@clerk/react/legacy";
import { AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/Card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const navigate = useNavigate();
  const location = useLocation();
  const rawFrom = (location.state as any)?.from?.pathname;
  const from = rawFrom && rawFrom !== "/login" ? rawFrom : "/";

  const {
    isLoaded: isSignInLoaded,
    signIn,
    setActive: setSignInActive,
  } = useSignIn();
  const {
    isLoaded: isSignUpLoaded,
    signUp,
    setActive: setSignUpActive,
  } = useSignUp();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resetInfo, setResetInfo] = useState<string | null>(null);

  const isLoaded = isSignInLoaded && isSignUpLoaded;

  // Handle standard Email + Password submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || isLoading) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      if (mode === "login") {
        if (!signIn) throw new Error("Clerk SignIn is not initialized");

        const result = await signIn.create({
          identifier: email,
          password,
        });

        if (result.status === "complete") {
          await setSignInActive({ session: result.createdSessionId });
          navigate(from, { replace: true });
        } else {
          setErrorMessage(
            `Additional authentication required (${result.status})`,
          );
        }
      } else {
        if (!signUp) throw new Error("Clerk SignUp is not initialized");

        const result = await signUp.create({
          emailAddress: email,
          password,
        });

        if (result.status === "complete") {
          await setSignUpActive({ session: result.createdSessionId });
          navigate(from, { replace: true });
        } else if (result.status === "missing_requirements") {
          // Prepare email verification code
          await signUp.prepareEmailAddressVerification({
            strategy: "email_code",
          });
          setIsVerifying(true);
        } else {
          setErrorMessage(`Sign up status: ${result.status}`);
        }
      }
    } catch (err: any) {
      console.error("[LoginForm] Authentication error:", err);
      const msg =
        err?.errors?.[0]?.longMessage ||
        err?.errors?.[0]?.message ||
        err?.message ||
        "Authentication failed. Please try again.";
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Email OTP verification step if required during signup
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || isLoading || !signUp) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const result = await signUp.attemptEmailAddressVerification({
        code: verificationCode.trim(),
      });

      if (result.status === "complete") {
        await setSignUpActive({ session: result.createdSessionId });
        navigate(from, { replace: true });
      } else {
        setErrorMessage(`Verification incomplete: status ${result.status}`);
      }
    } catch (err: any) {
      console.error("[LoginForm] Verification error:", err);
      const msg =
        err?.errors?.[0]?.longMessage ||
        err?.errors?.[0]?.message ||
        "Invalid verification code. Please check your email.";
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Social OAuth redirect
  const handleOAuth = async (strategy: any) => {
    if (!isLoaded || isLoading) return;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      if (mode === "login") {
        if (!signIn) return;
        await signIn.authenticateWithRedirect({
          strategy,
          redirectUrl: "/sso-callback",
          redirectUrlComplete: from,
        });
      } else {
        if (!signUp) return;
        await signUp.authenticateWithRedirect({
          strategy,
          redirectUrl: "/sso-callback",
          redirectUrlComplete: from,
        });
      }
    } catch (err: any) {
      console.error("[LoginForm] OAuth error:", err);
      const msg =
        err?.errors?.[0]?.longMessage ||
        err?.errors?.[0]?.message ||
        "Social login failed. Ensure provider is enabled in Clerk.";
      setErrorMessage(msg);
      setIsLoading(false);
    }
  };

  // Switch between Login and Sign up
  const toggleMode = () => {
    setErrorMessage(null);
    setIsVerifying(false);
    setMode((prev) => (prev === "login" ? "signup" : "login"));
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0 border shadow-lg">
        <CardContent className="grid p-0 md:grid-cols-2">
          {/* Email Verification Step */}
          {isVerifying ? (
            <form
              onSubmit={handleVerifyCode}
              className="p-6 md:p-8 flex flex-col justify-center"
            >
              <FieldGroup>
                <div className="flex flex-col items-center gap-2 text-center">
                  <h1 className="text-2xl font-bold tracking-tight">
                    Verify your email
                  </h1>
                  <p className="text-balance text-sm text-muted-foreground">
                    We sent a verification code to{" "}
                    <span className="font-medium text-foreground">{email}</span>
                  </p>
                </div>

                {errorMessage && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs font-medium">
                      {errorMessage}
                    </AlertDescription>
                  </Alert>
                )}



                <Field>
                  <FieldLabel htmlFor="code">Verification Code</FieldLabel>
                  <Input
                    id="code"
                    type="text"
                    placeholder="Enter 6-digit code"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    required
                    disabled={isLoading}
                    autoFocus
                  />
                </Field>

                <Field>
                  <Button type="submit" disabled={isLoading} className="w-full">
                    {isLoading ? (
                      <LoadingSpinner className="h-4 w-4 mr-2" />
                    ) : null}
                    Complete Sign Up
                  </Button>
                </Field>

                <FieldDescription className="text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setIsVerifying(false);
                      setErrorMessage(null);
                    }}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline hover:text-foreground transition-colors"
                  >
                    Back to sign up
                  </button>
                </FieldDescription>
              </FieldGroup>
            </form>
          ) : (
            /* Login & Signup Form */
            <form onSubmit={handleSubmit} className="p-6 md:p-8">
              <FieldGroup>
                <div className="flex flex-col items-center gap-2 text-center">
                  <h1 className="text-2xl font-bold tracking-tight">
                    {mode === "login" ? "Welcome back" : "Create an account"}
                  </h1>
                  <p className="text-balance text-sm text-muted-foreground">
                    {mode === "login"
                      ? "Login to your Matrix AI account"
                      : "Sign up to start chatting with AI and managing crawlers"}
                  </p>
                </div>

                {errorMessage && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs font-medium">
                      {errorMessage}
                    </AlertDescription>
                  </Alert>
                )}

                {resetInfo && (
                  <Alert variant="info" className="relative pr-8">
                    <Info className="h-4 w-4" />
                    <div>
                      <AlertTitle className="text-xs font-semibold">Password Reset</AlertTitle>
                      <AlertDescription className="text-xs mt-0.5">
                        {resetInfo}
                      </AlertDescription>
                    </div>
                    <button
                      type="button"
                      onClick={() => setResetInfo(null)}
                      className="absolute right-2 top-2 p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
                      aria-label="Dismiss message"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </Alert>
                )}



                <Field>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    placeholder="m@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={isLoading}
                  />
                </Field>

                <Field>
                  <div className="flex items-center">
                    <FieldLabel htmlFor="password">Password</FieldLabel>
                    {mode === "login" && (
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setResetInfo(
                            "Password reset is managed through your Clerk admin or registered email flow.",
                          );
                        }}
                        className="ml-auto text-sm text-muted-foreground underline-offset-2 hover:underline hover:text-foreground transition-colors"
                      >
                        Forgot your password?
                      </a>
                    )}
                  </div>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={isLoading}
                  />
                </Field>

                <Field>
                  <Button type="submit" disabled={isLoading} className="w-full">
                    {isLoading ? (
                      <LoadingSpinner className="h-4 w-4 mr-2" />
                    ) : null}
                    {mode === "login" ? "Login" : "Sign up"}
                  </Button>
                </Field>

                <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                  Or continue with
                </FieldSeparator>

                <Field className="grid grid-cols-3 gap-4">
                  <Button
                    variant="outline"
                    type="button"
                    disabled={true}
                    onClick={() => handleOAuth("oauth_apple")}
                    title="Sign in with Apple"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                    >
                      <path
                        d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
                        fill="currentColor"
                      />
                    </svg>
                    <span className="sr-only">Login with Apple</span>
                  </Button>

                  <Button
                    variant="outline"
                    type="button"
                    disabled={isLoading}
                    onClick={() => handleOAuth("oauth_google")}
                    title="Sign in with Google"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                    >
                      <path
                        d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                        fill="currentColor"
                      />
                    </svg>
                    <span className="sr-only">Login with Google</span>
                  </Button>

                  <Button
                    variant="outline"
                    type="button"
                    disabled={true}
                    onClick={() => handleOAuth("oauth_facebook")}
                    title="Sign in with Meta"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                    >
                      <path
                        d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z"
                        fill="currentColor"
                      />
                    </svg>
                    <span className="sr-only">Login with Meta</span>
                  </Button>
                </Field>

                <FieldDescription className="text-center">
                  {mode === "login" ? (
                    <>
                      Don&apos;t have an account?{" "}
                      <button
                        type="button"
                        onClick={toggleMode}
                        className="font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        Sign up
                      </button>
                    </>
                  ) : (
                    <>
                      Already have an account?{" "}
                      <button
                        type="button"
                        onClick={toggleMode}
                        className="font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        Login
                      </button>
                    </>
                  )}
                </FieldDescription>
              </FieldGroup>
            </form>
          )}

          {/* Right Side Visual Banner */}
          <div className="relative hidden bg-muted md:block overflow-hidden">
            <img
              src="/placeholder.svg"
              alt="Matrix AI Platform"
              className="absolute inset-0 h-full w-full object-cover dark:brightness-[0.9] transition-all"
            />
          </div>
        </CardContent>
      </Card>

      <FieldDescription className="px-6 text-center text-xs text-muted-foreground">
        By clicking continue, you agree to our{" "}
        <a
          href="#"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Terms of Service
        </a>{" "}
        and{" "}
        <a
          href="#"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Privacy Policy
        </a>
        .
      </FieldDescription>
    </div>
  );
}

export default LoginForm;
