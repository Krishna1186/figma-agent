# GitHub repo setup and push (testing branch only)

Git is initialized and your first commit is on the **`testing`** branch. To create the GitHub repo and push only that branch:

## 1. Create the repo on GitHub

- Go to [github.com/new](https://github.com/new).
- **Repository name:** `figma-agent` (or any name you prefer).
- Choose **Private** (or Public).
- **Do not** add a README, .gitignore, or license (they already exist locally).
- Click **Create repository**.

## 2. Add remote and push the testing branch

In a terminal, from this project folder (`figma-agent`), run (replace `YOUR_USERNAME` with your GitHub username):

```bash
git remote add origin https://github.com/YOUR_USERNAME/figma-agent.git
git push -u origin testing
```

This pushes **only** the `testing` branch. The `main` branch on GitHub will not exist yet (or will be empty if GitHub created it).

## 3. When you want to update main

After you’re happy with the work on `testing`, say when and we can merge `testing` into `main` and push `main`.
