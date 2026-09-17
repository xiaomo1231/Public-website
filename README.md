# Website

静态网站项目。

## 备份与回滚

每个功能阶段完成后打 tag：

```bash
git add -A
git commit -m "完成 XX 功能"
git tag v1.0-xxx
git push origin master --tags
```

回滚到指定阶段：

```bash
git checkout v1.0-xxx        # 查看历史版本
git checkout master           # 回到最新
git revert <commit-hash>      # 撤销某次提交
```

## 阶段 Tag 约定

- `v0.1-init`  - 初始脚手架
- `v0.2-home`  - 首页完成
- `v0.3-xxx`   - 按功能命名