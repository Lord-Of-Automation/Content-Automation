import LoginForm from "@/components/LoginForm";

export const metadata = { title: "Sign in — Content Automation" };

export default function LoginPage() {
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand" style={{ marginBottom: 18 }}>
          <span className="brand-dot" />
          <span>
            Content Automation
            <small>n8n workflow console</small>
          </span>
        </div>
        <div className="card">
          <div className="card-body">
            <h1>Sign in</h1>
            <p className="sub">Runs cost API credits, so this is not public.</p>
            <LoginForm />
          </div>
        </div>
      </div>
    </div>
  );
}
