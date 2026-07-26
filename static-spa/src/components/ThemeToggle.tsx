import { Moon, Sun } from "./icons";
import { useTheme } from "../lib/theme";
import { Button } from "./ui/button";

/** Sun/moon switch. Click pins an explicit light or dark choice. */
export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      className="h-8 w-8 text-muted-foreground hover:text-foreground"
    >
      {resolved === "dark" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </Button>
  );
}
