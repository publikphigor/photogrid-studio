export function Toast({ message }: { message: string }) {
  return (
    <div className="toast">
      <span className="dot" />
      <span>{message}</span>
    </div>
  );
}
