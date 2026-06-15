import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import ProtectedRoute from "@/components/ProtectedRoute";
import { DashboardDataProvider } from "@/context/DashboardDataContext";

const Login = lazy(() => import("@/pages/Login"));
const DashboardLayout = lazy(() => import("@/components/DashboardLayout"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const OnboardingBreRoute = lazy(() => import("@/features/onboarding-bre/ui/OnboardingBreRoute")
    .then((module) => ({ default: module.OnboardingBreRoute })));

const RouteFallback = () => (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Cargando...
    </div>
);

export const AppRouter = () => (
    <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
            <Routes>
                <Route path="/login" element={<Login />} />
                <Route
                    path="/onboarding-bre"
                    element={
                        <ProtectedRoute>
                            <OnboardingBreRoute />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/onboarding-bre/:projectId"
                    element={
                        <ProtectedRoute>
                            <OnboardingBreRoute />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/"
                    element={
                        <ProtectedRoute>
                            <DashboardDataProvider>
                                <DashboardLayout />
                            </DashboardDataProvider>
                        </ProtectedRoute>
                    }
                />
                <Route path="*" element={<NotFound />} />
            </Routes>
        </Suspense>
    </BrowserRouter>
);
