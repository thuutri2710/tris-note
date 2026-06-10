<script lang="ts">
  import type { NotionIcon } from "../../lib/types";
  let {
    icon,
    fallbackText = "",
  }: { icon: NotionIcon | null | undefined; fallbackText?: string } = $props();

  const letter = $derived((fallbackText.trim()[0] ?? "•").toUpperCase());
</script>

{#if icon?.kind === "emoji"}
  <span class="ico emoji">{icon.value}</span>
{:else if icon?.kind === "url"}
  <img class="ico img" src={icon.value} alt="" />
{:else}
  <span class="ico letter">{letter}</span>
{/if}

<style>
  .ico {
    width: 18px;
    height: 18px;
    flex: 0 0 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    line-height: 1;
  }
  .img {
    border-radius: 3px;
    object-fit: cover;
  }
  .letter {
    font-size: 10px;
    font-weight: 600;
    color: #5c5b57;
    background: transparent;
    border: 1px solid #d3d2ce;
    border-radius: 4px;
  }
</style>
