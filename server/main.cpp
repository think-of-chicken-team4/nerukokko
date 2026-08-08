#include <iostream>

struct EggStatus
{
    bool pickedUp = false;
    bool returnedToNest = false;
};

struct ChickenStatus
{
    bool alarmActive = false;
};

int main()
{
    EggStatus egg;
    ChickenStatus chicken;

    // アラーム開始
    chicken.alarmActive = true;

    std::cout << "アラーム開始" << std::endl;
    std::cout << "鶏：コケコッコー！" << std::endl;

    // 卵を持ち上げる
    egg.pickedUp = true;

    std::cout << "卵が持ち上げられました" << std::endl;

    // 卵を巣に戻す
    egg.returnedToNest = true;

    if (egg.returnedToNest)
    {
        chicken.alarmActive = false;

        std::cout << "卵が巣に戻りました" << std::endl;
        std::cout << "アラーム停止" << std::endl;
    }

    return 0;
}