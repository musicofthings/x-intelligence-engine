import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-opacity disabled:pointer-events-none disabled:opacity-40 min-h-11 px-4",
  {
    variants: {
      variant: {
        default: "bg-ink text-chrome hover:opacity-90",
        paper: "bg-paper text-paper-ink hover:opacity-90",
        copper: "bg-copper text-chrome hover:opacity-90",
        outline: "border border-line bg-transparent text-ink hover:bg-chrome-2",
        ghost: "text-ink hover:bg-chrome-2",
        pass: "border border-line text-muted hover:text-ink hover:bg-chrome-2",
      },
      size: {
        default: "h-11",
        sm: "h-9 min-h-9 px-3 text-xs",
        lg: "h-12 px-5",
        icon: "h-11 w-11 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
