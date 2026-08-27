import { Toaster as Sonner, toast } from "sonner";

import { useTheme } from "@/hooks/useTheme";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  // Antes vinha de `next-themes`, que nunca teve provider montado neste app:
  // o hook devolvia `undefined`, caía em "system" e os toasts ignoravam a
  // escolha manual de tema. O tema real é o do nosso próprio hook.
  const { isDark } = useTheme();

  return (
    <Sonner
      theme={isDark ? "dark" : "light"}
      className="toaster group"
      // Os toasts saem em `top-center`: sem o inset, encostam na status bar /
      // Dynamic Island em standalone e em WKWebView.
      offset="calc(env(safe-area-inset-top, 0px) + 1rem)"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
