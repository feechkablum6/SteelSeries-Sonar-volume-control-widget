function toRect(position, size) {
    return {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height
    };
}

function rectsOverlap(first, second, gap = 0) {
    return !(
        first.x + first.width <= second.x - gap ||
        first.x >= second.x + second.width + gap ||
        first.y + first.height <= second.y - gap ||
        first.y >= second.y + second.height + gap
    );
}

function clampPosition(position, size, bounds) {
    const maxX = bounds.x + Math.max(0, bounds.width - size.width);
    const maxY = bounds.y + Math.max(0, bounds.height - size.height);

    return {
        x: Math.min(Math.max(position.x, bounds.x), maxX),
        y: Math.min(Math.max(position.y, bounds.y), maxY)
    };
}

function moveOnXAxis(current, targetX, size, obstacles, gap) {
    let nextX = targetX;

    for (const obstacle of obstacles) {
        const verticallyAligned = !(
            current.y + size.height <= obstacle.y - gap ||
            current.y >= obstacle.y + obstacle.height + gap
        );
        if (!verticallyAligned) continue;

        if (targetX > current.x) {
            const wall = obstacle.x - gap - size.width;
            if (current.x <= wall && targetX > wall) nextX = Math.min(nextX, wall);
        } else if (targetX < current.x) {
            const wall = obstacle.x + obstacle.width + gap;
            if (current.x >= wall && targetX < wall) nextX = Math.max(nextX, wall);
        }
    }

    return nextX;
}

function moveOnYAxis(current, targetY, size, obstacles, gap) {
    let nextY = targetY;

    for (const obstacle of obstacles) {
        const horizontallyAligned = !(
            current.x + size.width <= obstacle.x - gap ||
            current.x >= obstacle.x + obstacle.width + gap
        );
        if (!horizontallyAligned) continue;

        if (targetY > current.y) {
            const wall = obstacle.y - gap - size.height;
            if (current.y <= wall && targetY > wall) nextY = Math.min(nextY, wall);
        } else if (targetY < current.y) {
            const wall = obstacle.y + obstacle.height + gap;
            if (current.y >= wall && targetY < wall) nextY = Math.max(nextY, wall);
        }
    }

    return nextY;
}

function moveWithCollisions(current, target, size, obstacles, bounds, gap = 0) {
    const boundedTarget = clampPosition(target, size, bounds);
    const afterX = {
        x: moveOnXAxis(current, boundedTarget.x, size, obstacles, gap),
        y: current.y
    };
    const afterY = {
        x: afterX.x,
        y: moveOnYAxis(afterX, boundedTarget.y, size, obstacles, gap)
    };

    return clampPosition(afterY, size, bounds);
}

function isPositionFree(position, size, obstacles, gap = 0) {
    const rect = toRect(position, size);
    return obstacles.every((obstacle) => !rectsOverlap(rect, obstacle, gap));
}

function findNearestFreePosition(desired, size, obstacles, bounds, gap = 0) {
    const origin = clampPosition(desired, size, bounds);
    if (isPositionFree(origin, size, obstacles, gap)) return origin;

    const maxX = bounds.x + Math.max(0, bounds.width - size.width);
    const maxY = bounds.y + Math.max(0, bounds.height - size.height);
    const xCandidates = new Set([bounds.x, maxX, origin.x]);
    const yCandidates = new Set([bounds.y, maxY, origin.y]);

    for (const obstacle of obstacles) {
        xCandidates.add(obstacle.x - gap - size.width);
        xCandidates.add(obstacle.x + obstacle.width + gap);
        yCandidates.add(obstacle.y - gap - size.height);
        yCandidates.add(obstacle.y + obstacle.height + gap);
    }

    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const rawX of xCandidates) {
        for (const rawY of yCandidates) {
            const candidate = clampPosition({ x: rawX, y: rawY }, size, bounds);
            if (!isPositionFree(candidate, size, obstacles, gap)) continue;

            const dx = candidate.x - origin.x;
            const dy = candidate.y - origin.y;
            const distance = dx * dx + dy * dy;
            if (distance < bestDistance) {
                best = candidate;
                bestDistance = distance;
            }
        }
    }

    return best;
}

module.exports = {
    rectsOverlap,
    clampPosition,
    moveWithCollisions,
    isPositionFree,
    findNearestFreePosition
};
