import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "@/components/avatar";

describe("Avatar", () => {
  it("renders an image with name as alt/title when src is present", () => {
    render(<Avatar src="https://example.com/a.png" name="Jane Doe" />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://example.com/a.png");
    expect(img).toHaveAttribute("alt", "Jane Doe");
    expect(img).toHaveAttribute("title", "Jane Doe");
  });

  it("falls back to initials when src is missing", () => {
    render(<Avatar name="Jane Doe" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("JD")).toBeInTheDocument();
  });

  it("treats an empty-string src as missing", () => {
    render(<Avatar src="" name="Alex Rivera" />);
    expect(screen.getByText("AR")).toBeInTheDocument();
  });
});
