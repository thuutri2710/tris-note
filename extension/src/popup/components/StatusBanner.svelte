<script lang="ts">
  let { kind, message }: { kind: "success" | "error" | "info"; message: string } =
    $props();
</script>

<div class="banner {kind}" role="status">{message}</div>

<style>
  .banner {
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 13px;
    margin: 8px 0;
  }
  .success { background: #e7f5ec; color: #1a7f43; }
  .error { background: #fdecea; color: #b3261e; }
  .info { background: #eef1f5; color: #444; }
</style>
