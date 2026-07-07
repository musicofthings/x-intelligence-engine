import { Component, type ReactNode } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Feed } from "./pages/Feed";
import { PostDetail } from "./pages/PostDetail";
import { Monitors } from "./pages/Monitors";
import { Alerts } from "./pages/Alerts";
import { Digests } from "./pages/Digests";
import { Usage, Settings, System, Sources, Rules, Watchlists } from "./pages/Misc";
import { ErrorState } from "./components/ui";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (this.state.error) return <div className="p-6"><ErrorState message={this.state.error.message} /></div>;
    return this.props.children;
  }
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "dashboard", element: <Dashboard /> },
      { path: "posts", element: <Feed /> },
      { path: "posts/:id", element: <PostDetail /> },
      { path: "monitors", element: <Monitors /> },
      { path: "watchlists", element: <Watchlists /> },
      { path: "rules", element: <Rules /> },
      { path: "alerts", element: <Alerts /> },
      { path: "digests", element: <Digests /> },
      { path: "sources", element: <Sources /> },
      { path: "usage", element: <Usage /> },
      { path: "settings", element: <Settings /> },
      { path: "system", element: <System /> },
    ],
  },
]);

export function App() {
  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
}
